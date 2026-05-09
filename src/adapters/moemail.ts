import { config } from '../config.js';
import type { BackendAdapter } from './base.js';
import type {
  CfOpenSettings,
  CfNewAddressResponse,
  CfMailListResponse,
  CfParsedMailListResponse,
  CfRawMail,
  CfParsedMail,
  CfSuccessResponse,
  CfAddressSettings,
} from '../types/cloudflare.js';

interface MoemailCreateEmailResponse {
  id: string;
  email: string;
}

interface MoemailEmail {
  id: string;
  address: string;
  createdAt?: string;
  expiresAt?: string;
  userId?: string;
}

interface MoemailEmailListResponse {
  emails: MoemailEmail[];
  nextCursor?: string;
  total?: number;
}

interface MoemailMessage {
  id: string;
  from_address?: string;
  to_address?: string;
  subject?: string;
  content?: string;
  html?: string;
  sent_at?: number;
  received_at?: number;
}

interface MoemailMessageListResponse {
  messages: MoemailMessage[];
  nextCursor?: string;
  total?: number;
}

interface MoemailMessageResponse {
  message: MoemailMessage;
}

/**
 * moemail 后端适配器
 *
 * 将 moemail 的邮箱/邮件模型转换为 everyMail 所需的 BackendAdapter 接口。
 */
export class MoemailAdapter implements BackendAdapter {
  readonly name = 'moemail';

  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? config.moemailBaseUrl;
    this.apiKey = apiKey ?? config.moemailAuth;
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
      throw new MoemailAdapterError('MOEMAIL_BASE_URL is required when MAIL_BACKEND=moemail', 500, '');
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

    if (options.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);

    if (!resp.ok) {
      const text = await resp.text();
      throw new MoemailAdapterError(
        `moemail API ${method} ${path} returned ${resp.status}: ${text}`,
        resp.status,
        text
      );
    }

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await resp.json()) as T;
    }

    return (await resp.text()) as unknown as T;
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    const domain = config.defaultDomain || 'moemail.app';
    return {
      title: 'moemail',
      domains: [domain],
      defaultDomains: [domain],
      enableUserCreateEmail: true,
      enableUserDeleteEmail: true,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    const created = await this.request<MoemailCreateEmailResponse>('POST', '/api/emails/generate', {
      body: {
        name,
        domain,
        expiryTime: 0,
      },
    });

    return {
      jwt: `${created.id}|${created.email}`,
      address: created.email,
    };
  }

  async loginAddress(address: string): Promise<{ jwt: string }> {
    return { jwt: address };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    return {
      address: extractAddress(jwt),
      send_balance: 0,
    };
  }

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    const emailId = await this.resolveEmailId(jwt);
    await this.request<unknown>('DELETE', `/api/emails/${emailId}`);
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const result = await this.fetchMessages(jwt, limit, offset);
    return {
      results: result.messages.map(message => toRawMail(message, extractAddress(jwt))),
      count: result.total,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const result = await this.fetchMessages(jwt, limit, offset);
    return {
      results: result.messages.map(message => toParsedMail(message, extractAddress(jwt))),
      count: result.total,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const emailId = await this.resolveEmailId(jwt);

    try {
      const result = await this.request<MoemailMessageResponse>('GET', `/api/emails/${emailId}/${mailId}`);
      return toRawMail(result.message, extractAddress(jwt));
    } catch (err) {
      if (err instanceof MoemailAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const emailId = await this.resolveEmailId(jwt);

    try {
      const result = await this.request<MoemailMessageResponse>('GET', `/api/emails/${emailId}/${mailId}`);
      return toParsedMail(result.message, extractAddress(jwt));
    } catch (err) {
      if (err instanceof MoemailAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    const emailId = await this.resolveEmailId(jwt);
    await this.request<unknown>('DELETE', `/api/emails/${emailId}/${mailId}`);
    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    const emailId = await this.resolveEmailId(jwt);
    await this.request<unknown>('DELETE', `/api/emails/${emailId}`);
    return { success: true };
  }

  private async fetchMessages(jwt: string, limit: number, offset: number): Promise<{ messages: MoemailMessage[]; total: number }> {
    const emailId = await this.resolveEmailId(jwt);
    const pageSize = Math.max(1, limit);
    let skipped = 0;
    let cursor: string | undefined;
    let total = 0;
    const collected: MoemailMessage[] = [];

    while (collected.length < pageSize) {
      const response = await this.request<MoemailMessageListResponse>('GET', `/api/emails/${emailId}`, {
        query: { cursor },
      });

      const messages = response.messages ?? [];
      total = response.total ?? total ?? messages.length;

      if (skipped + messages.length <= offset) {
        skipped += messages.length;
      } else {
        const startIndex = Math.max(0, offset - skipped);
        collected.push(...messages.slice(startIndex, startIndex + (pageSize - collected.length)));
        skipped += messages.length;
      }

      if (!response.nextCursor || messages.length === 0) {
        break;
      }

      cursor = response.nextCursor;
    }

    return {
      messages: collected,
      total,
    };
  }

  private async resolveEmailId(jwt: string): Promise<string> {
    const encodedId = extractEmailId(jwt);
    if (encodedId && encodedId !== jwt) {
      return encodedId;
    }

    const address = extractAddress(jwt);
    let cursor: string | undefined;

    while (true) {
      const result = await this.request<MoemailEmailListResponse>('GET', '/api/emails', {
        query: { cursor },
      });

      const match = result.emails.find(email => email.address === address);
      if (match) {
        return match.id;
      }

      if (!result.nextCursor || result.emails.length === 0) {
        break;
      }

      cursor = result.nextCursor;
    }

    throw new MoemailAdapterError(`Unable to resolve moemail mailbox ID for address: ${address}`, 404, address);
  }
}

export class MoemailAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'MoemailAdapterError';
  }
}

function extractEmailId(jwt: string): string {
  return jwt.split('|')[0] || '';
}

function extractAddress(jwt: string): string {
  return jwt.split('|').slice(1).join('|') || jwt;
}

function toMailTimestamp(message: MoemailMessage): string {
  const timestamp = message.received_at ?? message.sent_at;
  return typeof timestamp === 'number' ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function toRawMail(message: MoemailMessage, fallbackAddress: string): CfRawMail {
  return {
    id: hashString(message.id),
    source: message.from_address ?? '',
    address: message.to_address ?? fallbackAddress,
    raw: message.content ?? message.html ?? JSON.stringify(message),
    created_at: toMailTimestamp(message),
  };
}

function toParsedMail(message: MoemailMessage, fallbackAddress: string): CfParsedMail {
  const address = message.to_address ?? fallbackAddress;

  return {
    id: hashString(message.id),
    source: message.from_address ?? '',
    address,
    subject: message.subject,
    from: message.from_address,
    to: address,
    text: message.content,
    html: message.html,
    created_at: toMailTimestamp(message),
    attachments: [],
  };
}
