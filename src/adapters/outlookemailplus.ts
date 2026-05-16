import { config } from '../config.js';
import type { BackendAdapter } from './base.js';
import type {
  CfAddressSettings,
  CfMailListResponse,
  CfNewAddressResponse,
  CfOpenSettings,
  CfParsedMail,
  CfParsedMailListResponse,
  CfRawMail,
  CfSuccessResponse,
} from '../types/cloudflare.js';

interface OutlookEmailPlusResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

interface OutlookEmailPlusClaimData {
  account_id: number;
  email: string;
  email_domain?: string;
  claim_token: string;
  claimed_at?: string;
  lease_expires_at?: string;
}

interface OutlookEmailPlusMessageListData {
  emails?: OutlookEmailPlusMessage[];
  count?: number;
  has_more?: boolean;
}

interface OutlookEmailPlusMessage {
  id: string | number;
  email_address?: string;
  from_address?: string;
  to_address?: string;
  subject?: string;
  content?: string;
  html_content?: string;
  raw_content?: string;
  timestamp?: string;
  created_at?: string;
  has_html?: boolean;
  method?: string;
}

interface OutlookEmailPlusMailboxState {
  accountId?: number;
  email: string;
  claimToken?: string;
  callerId?: string;
  taskId?: string;
}

const MESSAGE_ID_CACHE_LIMIT = 500;

/**
 * OutlookEmailPlus 后端适配器。
 *
 * 通过 /api/external/* 受控接口读取邮件；创建地址映射为邮箱池 claim-random。
 */
export class OutlookEmailPlusAdapter implements BackendAdapter {
  readonly name = 'outlookemailplus';

  private baseUrl: string;
  private apiKey: string;
  private provider: string;
  private callerId: string;
  private projectKey: string;
  private messageIdCache = new Map<string, Map<number, string>>();

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? config.outlookEmailPlusBaseUrl;
    this.apiKey = apiKey ?? config.outlookEmailPlusAuth;
    this.provider = config.outlookEmailPlusProvider;
    this.callerId = config.outlookEmailPlusCallerId;
    this.projectKey = config.outlookEmailPlusProjectKey;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new OutlookEmailPlusAdapterError(
        'OUTLOOKEMAILPLUS_BASE_URL is required when MAIL_BACKEND=outlookemailplus',
        500,
        ''
      );
    }

    const url = new URL(path, this.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: this.buildHeaders(),
    };

    if (options.body !== undefined && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);
    const contentType = resp.headers.get('content-type') ?? '';
    const bodyText = await resp.text();

    if (!resp.ok) {
      throw new OutlookEmailPlusAdapterError(
        `OutlookEmailPlus API ${method} ${path} returned ${resp.status}: ${bodyText}`,
        resp.status,
        bodyText
      );
    }

    const parsed = contentType.includes('application/json') && bodyText
      ? JSON.parse(bodyText) as unknown
      : bodyText;

    if (isOutlookEmailPlusResponse(parsed)) {
      if (!parsed.success) {
        throw new OutlookEmailPlusAdapterError(
          `OutlookEmailPlus API ${method} ${path} returned ${parsed.code}: ${parsed.message}`,
          toStatusCode(parsed.code),
          bodyText
        );
      }

      return parsed.data as T;
    }

    return parsed as T;
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    const domains = config.defaultDomain
      ? [config.defaultDomain]
      : ['outlook.com', 'hotmail.com', 'live.com', 'live.cn'];

    return {
      title: 'OutlookEmailPlus',
      domains,
      defaultDomains: domains,
      enableUserCreateEmail: true,
      enableUserDeleteEmail: true,
    };
  }

  async createAddress(_name: string, domain: string): Promise<CfNewAddressResponse> {
    const taskId = createTaskId();
    const body: Record<string, string> = {
      caller_id: this.callerId,
      task_id: taskId,
      provider: this.provider,
    };

    if (this.projectKey) {
      body.project_key = this.projectKey;
    }

    if (this.provider === 'cloudflare_temp_mail' && domain) {
      body.email_domain = domain;
    }

    const claim = await this.request<OutlookEmailPlusClaimData>('POST', '/api/external/pool/claim-random', {
      body,
    });

    return {
      jwt: encodeMailboxState({
        accountId: claim.account_id,
        email: claim.email,
        claimToken: claim.claim_token,
        callerId: this.callerId,
        taskId,
      }),
      address: claim.email,
      address_id: claim.account_id,
    };
  }

  async loginAddress(address: string): Promise<{ jwt: string }> {
    return {
      jwt: encodeMailboxState({ email: address }),
    };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    return {
      address: decodeMailboxState(jwt).email,
      send_balance: 0,
    };
  }

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    const state = decodeMailboxState(jwt);
    if (!hasClaim(state)) {
      return { success: true };
    }

    await this.request<unknown>('POST', '/api/external/pool/claim-release', {
      body: {
        account_id: state.accountId,
        claim_token: state.claimToken,
        caller_id: state.callerId,
        task_id: state.taskId,
        reason: 'released by everyMail',
      },
    });

    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const state = decodeMailboxState(jwt);
    const result = await this.fetchMessages(state.email, limit, offset);

    return {
      results: result.messages.map(message => toRawMail(message, state.email)),
      count: result.count,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const state = decodeMailboxState(jwt);
    const result = await this.fetchMessages(state.email, limit, offset);

    return {
      results: result.messages.map(message => toParsedMail(message, state.email)),
      count: result.count,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const state = decodeMailboxState(jwt);
    const resolvedId = await this.resolveMessageId(state.email, mailId);

    try {
      const message = await this.request<OutlookEmailPlusMessage>(
        'GET',
        `/api/external/messages/${encodeURIComponent(resolvedId)}`,
        { query: { email: state.email } }
      );
      return toRawMail(message, state.email);
    } catch (err) {
      if (err instanceof OutlookEmailPlusAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const state = decodeMailboxState(jwt);
    const resolvedId = await this.resolveMessageId(state.email, mailId);

    try {
      const message = await this.request<OutlookEmailPlusMessage>(
        'GET',
        `/api/external/messages/${encodeURIComponent(resolvedId)}`,
        { query: { email: state.email } }
      );
      return toParsedMail(message, state.email);
    } catch (err) {
      if (err instanceof OutlookEmailPlusAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(_jwt: string, _mailId: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async clearInbox(_jwt: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  private async fetchMessages(email: string, limit: number, offset: number): Promise<{ messages: OutlookEmailPlusMessage[]; count: number }> {
    const top = Math.min(50, Math.max(1, limit));
    const data = await this.request<OutlookEmailPlusMessageListData>('GET', '/api/external/messages', {
      query: {
        email,
        skip: Math.max(0, offset),
        top,
      },
    });

    const messages = data.emails ?? [];
    this.rememberMessageIds(email, messages);

    return {
      messages,
      count: data.count ?? messages.length,
    };
  }

  private async resolveMessageId(email: string, mailId: string): Promise<string> {
    const numericId = Number.parseInt(mailId, 10);
    if (!Number.isNaN(numericId)) {
      const cachedId = this.getCachedMessageId(email, numericId);
      if (cachedId) {
        return cachedId;
      }
    }

    await this.fetchMessages(email, 50, 0);
    if (!Number.isNaN(numericId)) {
      const cachedId = this.getCachedMessageId(email, numericId);
      if (cachedId) {
        return cachedId;
      }
    }

    return mailId;
  }

  private rememberMessageIds(email: string, messages: OutlookEmailPlusMessage[]): void {
    const cache = this.getMessageCache(email);

    for (const message of messages) {
      const providerId = String(message.id);
      const numericId = toNumericId(providerId);
      cache.delete(numericId);
      cache.set(numericId, providerId);
    }

    while (cache.size > MESSAGE_ID_CACHE_LIMIT) {
      const oldestId = cache.keys().next().value;
      if (oldestId === undefined) {
        break;
      }
      cache.delete(oldestId);
    }
  }

  private getCachedMessageId(email: string, numericId: number): string | undefined {
    const cache = this.messageIdCache.get(email);
    if (!cache) {
      return undefined;
    }

    const providerId = cache.get(numericId);
    if (!providerId) {
      return undefined;
    }

    cache.delete(numericId);
    cache.set(numericId, providerId);
    return providerId;
  }

  private getMessageCache(email: string): Map<number, string> {
    const existing = this.messageIdCache.get(email);
    if (existing) {
      return existing;
    }

    const created = new Map<number, string>();
    this.messageIdCache.set(email, created);
    return created;
  }
}

export class OutlookEmailPlusAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'OutlookEmailPlusAdapterError';
  }
}

function isOutlookEmailPlusResponse(value: unknown): value is OutlookEmailPlusResponse<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'code' in value
    && 'message' in value
    && 'data' in value;
}

function toStatusCode(code: string): number {
  const normalized = code.toLowerCase();
  if (normalized === 'no_available_account' || normalized === 'mail_not_found' || normalized === 'account_not_found') {
    return 404;
  }

  if (normalized === 'unauthorized' || normalized === 'api_key_not_configured') {
    return 401;
  }

  if (normalized === 'forbidden' || normalized === 'email_scope_forbidden' || normalized === 'account_access_forbidden') {
    return 403;
  }

  if (normalized === 'invalid_param') {
    return 400;
  }

  if (normalized === 'rate_limit_exceeded') {
    return 429;
  }

  return 502;
}

function createTaskId(): string {
  return `everymail-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function encodeMailboxState(state: OutlookEmailPlusMailboxState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

function decodeMailboxState(jwt: string): OutlookEmailPlusMailboxState {
  try {
    const parsed = JSON.parse(Buffer.from(jwt, 'base64url').toString('utf8')) as unknown;
    if (isMailboxState(parsed)) {
      return parsed;
    }
  } catch (err) {
    if (err instanceof Error) {
      return { email: jwt };
    }
    throw err;
  }

  return { email: jwt };
}

function isMailboxState(value: unknown): value is OutlookEmailPlusMailboxState {
  return typeof value === 'object'
    && value !== null
    && 'email' in value
    && typeof value.email === 'string';
}

function hasClaim(state: OutlookEmailPlusMailboxState): state is Required<Pick<OutlookEmailPlusMailboxState, 'accountId' | 'claimToken' | 'callerId' | 'taskId'>> & OutlookEmailPlusMailboxState {
  return typeof state.accountId === 'number'
    && typeof state.claimToken === 'string'
    && typeof state.callerId === 'string'
    && typeof state.taskId === 'string';
}

function toRawMail(message: OutlookEmailPlusMessage, fallbackAddress: string): CfRawMail {
  return {
    id: toNumericId(String(message.id)),
    source: message.from_address ?? '',
    address: message.to_address ?? message.email_address ?? fallbackAddress,
    raw: message.raw_content ?? message.content ?? message.html_content ?? JSON.stringify(message),
    created_at: getMessageDate(message),
  };
}

function toParsedMail(message: OutlookEmailPlusMessage, fallbackAddress: string): CfParsedMail {
  const address = message.to_address ?? message.email_address ?? fallbackAddress;

  return {
    id: toNumericId(String(message.id)),
    source: message.from_address ?? '',
    address,
    subject: message.subject,
    from: message.from_address,
    to: address,
    text: message.content,
    html: message.html_content,
    created_at: getMessageDate(message),
    attachments: [],
  };
}

function getMessageDate(message: OutlookEmailPlusMessage): string {
  const value = message.created_at ?? message.timestamp;
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function toNumericId(id: string): number {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}
