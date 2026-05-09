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
import type {
  CloudMailAccount,
  CloudMailAccountList,
  CloudMailEmail,
  CloudMailEmailList,
  CloudMailOpenSettings,
  CloudMailResponse,
} from '../types/cloudmail.js';

/**
 * CloudMail 后端适配器
 *
 * CloudMail 是完整邮箱系统，不是 cloudflare_temp_email 的同构临时邮箱 API。
 * 本适配器将 CloudMail 的 account/email 模型投影为 everyMail 的 BackendAdapter。
 */
export class CloudMailAdapter implements BackendAdapter {
  readonly name = 'cloudmail';

  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl?: string, authToken?: string) {
    this.baseUrl = baseUrl ?? config.cloudmailBaseUrl;
    this.authToken = authToken ?? config.cloudmailAuth;
  }

  private buildHeaders(token = this.authToken): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = token;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      token?: string;
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      unwrap?: boolean;
    } = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new CloudMailAdapterError('CLOUDMAIL_BASE_URL is required when MAIL_BACKEND=cloudmail', 500);
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
      headers: this.buildHeaders(options.token),
    };

    if (options.body !== undefined && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);
    const contentType = resp.headers.get('content-type') ?? '';
    const bodyText = await resp.text();

    if (!resp.ok) {
      throw new CloudMailAdapterError(
        `CloudMail API ${method} ${path} returned ${resp.status}: ${bodyText}`,
        resp.status,
        bodyText
      );
    }

    const parsed = contentType.includes('application/json') && bodyText
      ? JSON.parse(bodyText) as unknown
      : bodyText;

    if (options.unwrap === false) {
      return parsed as T;
    }

    if (isCloudMailResponse(parsed)) {
      if (parsed.code !== 200) {
        throw new CloudMailAdapterError(
          `CloudMail API ${method} ${path} returned code ${parsed.code}: ${parsed.message}`,
          parsed.code,
          bodyText
        );
      }
      return parsed.data as T;
    }

    return parsed as T;
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    const settings = await this.tryRequest<CloudMailOpenSettings>('GET', '/open_api/settings', { unwrap: true });
    const domains = extractDomains(settings);

    return {
      title: settings?.title ?? 'CloudMail',
      domains,
      defaultDomains: domains,
      enableUserCreateEmail: true,
      enableUserDeleteEmail: true,
      enableSendMail: true,
      version: settings?.version,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    const address = name.includes('@') ? name : `${name}@${domain}`;
    const account = await this.request<CloudMailAccount>('POST', '/account/add', {
      body: { email: address },
    });

    return {
      jwt: this.authToken,
      address: getAccountAddress(account) ?? address,
      address_id: toNumericId(account.id),
    };
  }

  async loginAddress(address: string): Promise<{ jwt: string }> {
    if (!this.authToken) {
      throw new CloudMailAdapterError(
        'CLOUDMAIL_AUTH is required because CloudMail does not expose cloudflare_temp_email-style address_login',
        401
      );
    }

    return { jwt: `${this.authToken}|${address}` };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    const address = extractAddressFromJwt(jwt) ?? await this.findFirstAddress(jwt);
    return {
      address,
      send_balance: 0,
    };
  }

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    const address = extractAddressFromJwt(jwt);
    await this.request<unknown>('DELETE', '/account/delete', {
      token: extractCloudMailToken(jwt),
      body: address ? { email: address } : undefined,
    });
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const result = await this.fetchEmailList(jwt, limit, offset);
    const mails = (result.list ?? []).map(email => toRawMail(email));
    return {
      results: mails,
      count: result.total ?? mails.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const result = await this.fetchEmailList(jwt, limit, offset);
    const mails = (result.list ?? []).map(email => toParsedMail(email));
    return {
      results: mails,
      count: result.total ?? mails.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const mail = await this.findMail(jwt, mailId);
    return mail ? toRawMail(mail) : null;
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const mail = await this.findMail(jwt, mailId);
    return mail ? toParsedMail(mail) : null;
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    await this.request<unknown>('DELETE', '/email/delete', {
      token: extractCloudMailToken(jwt),
      body: { emailIds: [mailId], ids: [mailId], id: mailId },
    });
    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    const mails = await this.listParsedMails(jwt, 100, 0);
    if (mails.results.length === 0) {
      return { success: true };
    }

    await this.request<unknown>('DELETE', '/email/delete', {
      token: extractCloudMailToken(jwt),
      body: { emailIds: mails.results.map(mail => mail.id), ids: mails.results.map(mail => mail.id) },
    });
    return { success: true };
  }

  private async fetchEmailList(jwt: string, limit: number, offset: number): Promise<CloudMailEmailList> {
    const pageSize = Math.max(1, limit);
    const page = Math.floor(offset / pageSize) + 1;
    const address = extractAddressFromJwt(jwt);

    return this.request<CloudMailEmailList>('GET', '/email/list', {
      token: extractCloudMailToken(jwt),
      query: {
        page,
        pageSize,
        size: pageSize,
        email: address,
      },
    });
  }

  private async findMail(jwt: string, mailId: string): Promise<CloudMailEmail | null> {
    const list = await this.fetchEmailList(jwt, 100, 0);
    return (list.list ?? []).find(mail => String(getEmailId(mail)) === mailId) ?? null;
  }

  private async findFirstAddress(jwt: string): Promise<string> {
    const accounts = await this.tryRequest<CloudMailAccountList | CloudMailAccount[]>('GET', '/account/list', {
      token: extractCloudMailToken(jwt),
    });

    const list = Array.isArray(accounts) ? accounts : accounts?.list ?? [];
    return getAccountAddress(list[0]) ?? 'cloudmail@example.invalid';
  }

  private async tryRequest<T>(
    method: string,
    path: string,
    options: Parameters<CloudMailAdapter['request']>[2] = {}
  ): Promise<T | undefined> {
    try {
      return await this.request<T>(method, path, options);
    } catch (err) {
      if (err instanceof CloudMailAdapterError && err.statusCode === 404) {
        return undefined;
      }
      throw err;
    }
  }
}

export class CloudMailAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody = ''
  ) {
    super(message);
    this.name = 'CloudMailAdapterError';
  }
}

function isCloudMailResponse(value: unknown): value is CloudMailResponse<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'message' in value
    && 'data' in value;
}

function extractCloudMailToken(jwt: string): string {
  return jwt.split('|')[0] || jwt;
}

function extractAddressFromJwt(jwt: string): string | undefined {
  const parts = jwt.split('|');
  return parts.length > 1 ? parts.slice(1).join('|') : undefined;
}

function extractDomains(settings?: CloudMailOpenSettings): string[] {
  if (!settings) {
    return [];
  }

  if (Array.isArray(settings.domains)) {
    return settings.domains;
  }

  if (Array.isArray(settings.domainList)) {
    return settings.domainList
      .map(domain => typeof domain === 'string' ? domain : domain.name ?? domain.domain ?? domain.value ?? '')
      .filter(domain => domain.length > 0);
  }

  return [];
}

function getAccountAddress(account?: CloudMailAccount): string | undefined {
  return account?.email ?? account?.account ?? account?.address ?? account?.name;
}

function getEmailId(mail: CloudMailEmail): string | number {
  return mail.id ?? mail.emailId ?? '';
}

function getEmailDate(mail: CloudMailEmail): string {
  return mail.createTime ?? mail.createdAt ?? mail.created_at ?? new Date().toISOString();
}

function toNumericId(id: string | number | undefined): number | undefined {
  if (typeof id === 'number') {
    return id;
  }

  if (typeof id === 'string') {
    const parsed = Number.parseInt(id, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function toRawMail(mail: CloudMailEmail): CfRawMail {
  const id = toNumericId(getEmailId(mail)) ?? 0;
  const address = mail.toEmail ?? mail.to ?? mail.recipient ?? '';
  const raw = mail.raw ?? mail.content ?? mail.text ?? mail.html ?? '';

  return {
    id,
    source: mail.fromEmail ?? mail.from ?? mail.sender ?? '',
    address,
    raw,
    created_at: getEmailDate(mail),
  };
}

function toParsedMail(mail: CloudMailEmail): CfParsedMail {
  const id = toNumericId(getEmailId(mail)) ?? 0;
  const address = mail.toEmail ?? mail.to ?? mail.recipient ?? '';

  return {
    id,
    source: mail.fromEmail ?? mail.from ?? mail.sender ?? '',
    address,
    subject: mail.subject ?? '(no subject)',
    from: mail.fromEmail ?? mail.from ?? mail.sender ?? '',
    to: address,
    text: mail.text ?? mail.content ?? '',
    html: mail.html ?? '',
    created_at: getEmailDate(mail),
    attachments: mail.attachments?.map(att => ({
      filename: att.filename ?? att.name,
      mimeType: att.mimeType ?? att.mime_type,
      size: att.size,
    })),
  };
}
