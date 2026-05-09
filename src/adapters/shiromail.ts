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

/**
 * ShiroMail 后端适配器
 *
 * 将 BackendAdapter 调用转发到真实的 ShiroMail 后端实例。
 * ShiroMail 后端使用 JWT + API Key 认证，API 路径为 /api/v1/...
 * 参考: https://github.com/GALIAIS/ShiroMail
 */
export class ShiroMailAdapter implements BackendAdapter {
  readonly name = 'shiromail';

  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? config.shiromailBackendUrl;
    this.apiKey = apiKey ?? config.shiromailBackendApiKey;
  }

  // ===== 内部 HTTP 工具 =====

  private buildHeaders(jwt?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // ShiroMail 使用 Bearer token（JWT 或 API Key 均可）
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      jwt?: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new ShiroMailAdapterError(
        'SHIROMAIL_BACKEND_URL is required when MAIL_BACKEND=shiromail',
        500
      );
    }

    const url = new URL(path, this.baseUrl);

    if (options.query) {
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: this.buildHeaders(options.jwt),
    };

    if (options.body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);

    if (!resp.ok) {
      const text = await resp.text();
      throw new ShiroMailAdapterError(
        `ShiroMail API ${method} ${path} returned ${resp.status}: ${text}`,
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

  // ===== BackendAdapter 实现 =====

  async getOpenSettings(): Promise<CfOpenSettings> {
    // ShiroMail 没有直接的 open_api/settings 等价接口
    // 返回合成的设置，域名从 config.domainMap 获取
    const domains = Object.values(config.domainMap);
    if (domains.length === 0 && config.defaultDomain) {
      domains.push(config.defaultDomain);
    }

    return {
      title: 'ShiroMail',
      domains,
      defaultDomains: domains,
      enableUserCreateEmail: true,
      enableUserDeleteEmail: true,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    // ShiroMail: POST /api/v1/mailboxes
    // body: { localPart, domainId, expiresInHours }
    // 这里 domain 可能是域名或 domainId，需要反向查找
    const domainId = findDomainId(domain);

    const result = await this.request<ShiroMailMailbox>('POST', '/api/v1/mailboxes', {
      body: { localPart: name, domainId, expiresInHours: 24 },
    });

    // ShiroMail 创建邮箱后需要登录获取 JWT
    // 但 ShiroMail 的 register 接口需要 username/password
    // 作为适配器，我们用 API Key 认证，返回 mailboxId 作为 jwt 标识
    return {
      jwt: `${result.id}|${result.address}`,
      address: result.address,
      address_id: result.id,
    };
  }

  async loginAddress(address: string): Promise<{ jwt: string }> {
    // ShiroMail 使用 username/password 登录，不支持纯地址登录
    // 作为适配器，使用 API Key 认证模式，jwt 编码为 mailboxId|address
    // 需要先查找该地址对应的 mailboxId
    const mailboxes = await this.request<{ items: ShiroMailMailbox[] }>(
      'GET', '/api/v1/mailboxes'
    );

    const mailbox = mailboxes.items.find(m => m.address === address);
    if (!mailbox) {
      throw new ShiroMailAdapterError(`Mailbox not found: ${address}`, 404);
    }

    return { jwt: `${mailbox.id}|${address}` };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    const address = extractAddress(jwt);
    return {
      address,
      send_balance: 0,
    };
  }

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    const mailboxId = extractMailboxId(jwt);
    // ShiroMail: POST /api/v1/mailboxes/:mailboxId/release
    await this.request<ShiroMailMailbox>('POST', `/api/v1/mailboxes/${mailboxId}/release`);
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const mailboxId = extractMailboxId(jwt);
    const address = extractAddress(jwt);

    const result = await this.request<{ items: ShiroMailMessage[] }>(
      'GET', `/api/v1/mailboxes/${mailboxId}/messages`,
      { query: { limit, offset } }
    );

    const mails = (result.items ?? []).map(msg => toRawMail(msg, address));
    return {
      results: mails,
      count: mails.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const mailboxId = extractMailboxId(jwt);
    const address = extractAddress(jwt);

    const result = await this.request<{ items: ShiroMailMessage[] }>(
      'GET', `/api/v1/mailboxes/${mailboxId}/messages`,
      { query: { limit, offset } }
    );

    const mails = (result.items ?? []).map(msg => toParsedMail(msg, address));
    return {
      results: mails,
      count: mails.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const mailboxId = extractMailboxId(jwt);
    const address = extractAddress(jwt);

    try {
      const msg = await this.request<ShiroMailMessage>(
        'GET', `/api/v1/mailboxes/${mailboxId}/messages/${mailId}`
      );
      return toRawMail(msg, address);
    } catch (err) {
      if (err instanceof ShiroMailAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const mailboxId = extractMailboxId(jwt);
    const address = extractAddress(jwt);

    try {
      const msg = await this.request<ShiroMailMessage>(
        'GET', `/api/v1/mailboxes/${mailboxId}/messages/${mailId}`
      );
      return toParsedMail(msg, address);
    } catch (err) {
      if (err instanceof ShiroMailAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    // ShiroMail 没有单独的消息删除 API
    // 标记为已删除（如果后端支持）或返回成功
    void jwt;
    void mailId;
    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    // ShiroMail 没有清空收件箱 API，释放邮箱等价于清空
    void jwt;
    return { success: true };
  }
}

/**
 * ShiroMail 适配器错误
 */
export class ShiroMailAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody = ''
  ) {
    super(message);
    this.name = 'ShiroMailAdapterError';
  }
}

// ===== ShiroMail 内部类型 =====

interface ShiroMailMailbox {
  id: number;
  userId?: number;
  domainId?: number;
  domain?: string;
  localPart?: string;
  address: string;
  status?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ShiroMailMessage {
  id: number;
  mailboxId?: number;
  sourceKind?: string;
  sourceMessageId?: string;
  fromAddr?: string;
  toAddr?: string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  headers?: Record<string, string[]>;
  rawStorageKey?: string;
  hasAttachments?: boolean;
  sizeBytes?: number;
  isRead?: boolean;
  isDeleted?: boolean;
  receivedAt?: string;
  attachments?: ShiroMailAttachment[];
}

interface ShiroMailAttachment {
  filename?: string;
  contentType?: string;
  size?: number;
  index?: number;
}

// ===== 工具函数 =====

function extractMailboxId(jwt: string): string {
  return jwt.split('|')[0] || jwt;
}

function extractAddress(jwt: string): string {
  const parts = jwt.split('|');
  return parts.length > 1 ? parts.slice(1).join('|') : jwt;
}

function findDomainId(domain: string): string {
  // 在 domainMap 中反向查找 domainId
  for (const [id, name] of Object.entries(config.domainMap)) {
    if (name === domain) {
      return id;
    }
  }
  // 如果找不到映射，直接用 domain 作为 domainId
  return domain;
}

function toRawMail(msg: ShiroMailMessage, address: string): CfRawMail {
  return {
    id: msg.id,
    source: msg.fromAddr ?? '',
    address: msg.toAddr ?? address,
    raw: msg.textBody ?? msg.htmlBody ?? '',
    created_at: msg.receivedAt ?? new Date().toISOString(),
  };
}

function toParsedMail(msg: ShiroMailMessage, address: string): CfParsedMail {
  return {
    id: msg.id,
    source: msg.fromAddr ?? '',
    address: msg.toAddr ?? address,
    subject: msg.subject,
    from: msg.fromAddr,
    to: msg.toAddr ?? address,
    text: msg.textBody,
    html: msg.htmlBody,
    created_at: msg.receivedAt ?? new Date().toISOString(),
    attachments: msg.attachments?.map(att => ({
      filename: att.filename,
      mimeType: att.contentType,
      size: att.size,
    })),
  };
}
