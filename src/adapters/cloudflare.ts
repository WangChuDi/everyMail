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
 * cloudflare_temp_email 后端适配器
 *
 * 将标准 BackendAdapter 调用转换为 CF Worker API 请求。
 * API 路由参考: https://github.com/dreamhunter2333/cloudflare_temp_email/blob/main/worker/src/
 */
export class CloudflareAdapter implements BackendAdapter {
  readonly name = 'cloudflare_temp_email';

  private baseUrl: string;
  private authPassword: string;

  constructor(baseUrl?: string, authPassword?: string) {
    this.baseUrl = baseUrl ?? config.cfBaseUrl;
    this.authPassword = authPassword ?? config.cfAuth;
  }

  // ===== 内部 HTTP 工具 =====

  private buildHeaders(jwt?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authPassword) {
      headers['x-custom-auth'] = this.authPassword;
    }
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
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
    const url = new URL(path, this.baseUrl);

    // 追加 query 参数
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

    if (options.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);

    if (!resp.ok) {
      const text = await resp.text();
      throw new CloudflareAdapterError(
        `CF API ${method} ${path} returned ${resp.status}: ${text}`,
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
    return this.request<CfOpenSettings>('GET', '/open_api/settings');
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    return this.request<CfNewAddressResponse>('POST', '/api/new_address', {
      body: { name, domain },
    });
  }

  async loginAddress(address: string, password: string): Promise<{ jwt: string }> {
    return this.request<{ jwt: string }>('POST', '/api/address_login', {
      body: { address, password },
    });
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    return this.request<CfAddressSettings>('GET', '/api/settings', { jwt });
  }

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    return this.request<CfSuccessResponse>('DELETE', '/api/delete_address', { jwt });
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    return this.request<CfMailListResponse>('GET', '/api/mails', {
      jwt,
      query: { limit, offset },
    });
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    return this.request<CfParsedMailListResponse>('GET', '/api/parsed_mails', {
      jwt,
      query: { limit, offset },
    });
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    try {
      return await this.request<CfRawMail>('GET', `/api/mail/${mailId}`, { jwt });
    } catch (err) {
      if (err instanceof CloudflareAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    try {
      return await this.request<CfParsedMail>('GET', `/api/parsed_mail/${mailId}`, { jwt });
    } catch (err) {
      if (err instanceof CloudflareAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    return this.request<CfSuccessResponse>('DELETE', `/api/mails/${mailId}`, { jwt });
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    return this.request<CfSuccessResponse>('DELETE', '/api/clear_inbox', { jwt });
  }
}

/**
 * Cloudflare 适配器错误
 */
export class CloudflareAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'CloudflareAdapterError';
  }
}
