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

const BASE_URL = 'https://www.2925.com';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'pragma': 'no-cache',
  'cache-control': 'no-cache',
  'sec-ch-ua-platform': '"Windows"',
  'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'sec-ch-ua-mobile': '?0',
  'origin': 'https://www.2925.com',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'referer': 'https://www.2925.com/',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

interface Mail2925ListItem {
  messageId: string;
  subject: string;
  fromAddress: string;
  toAddress: string[];
  bodyContent: string;
  createTime: string;
}

interface Mail2925ReadResult {
  bodyHtmlText: string;
  subject?: string;
  fromAddress?: string;
  toAddress?: string[];
}

export class Mail2925Adapter implements BackendAdapter {
  readonly name = '2925';

  private cookie: string;
  private domain: string;
  private token: string | null = null;

  constructor(cookie?: string, domain?: string) {
    this.cookie = cookie ?? config.mail2925Cookie;
    this.domain = domain ?? config.mail2925Domain;
    this.refreshToken();
  }

  private buildHeaders(withAuth: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      'Host': 'www.2925.com',
      'Cookie': this.cookie,
    };
    if (withAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async refreshToken(): Promise<boolean> {
    const resp = await fetch(`${BASE_URL}/mailv2/auth/token`, {
      method: 'POST',
      headers: this.buildHeaders(false),
      body: JSON.stringify({ timeout: 5000 }),
    });
    const data = await resp.json() as { code?: number; result?: string };
    if (data.code === 200 && data.result) {
      this.token = data.result;
      console.log('[2925] Token refreshed successfully');
      return true;
    }
    console.warn('[2925] Failed to refresh token');
    return false;
  }

  private async requestWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    const resp = await fetch(url, init);
    const data = await resp.json() as Record<string, unknown>;

    if (data.status_code === 401 || resp.status === 401) {
      const refreshed = await this.refreshToken();
      if (!refreshed) {
        throw new Mail2925AdapterError('Cookie expired, cannot refresh token', 401);
      }
      const retryInit = { ...init, headers: this.buildHeaders(true) };
      const retryResp = await fetch(url, retryInit);
      return (await retryResp.json()) as T;
    }

    return data as T;
  }

  private async getMailList(pageIndex = 1, pageCount = 25): Promise<Mail2925ListItem[]> {
    if (!this.token) {
      await this.refreshToken();
    }

    const url = `${BASE_URL}/mailv2/maildata/MailList/mails?Folder=Inbox&FilterType=0&PageIndex=${pageIndex}&PageCount=${pageCount}`;
    const data = await this.requestWithRetry<{ code?: number; result?: { list?: Mail2925ListItem[] } }>(
      url,
      { method: 'GET', headers: this.buildHeaders(true) }
    );

    if (data.code === 200) {
      return data.result?.list ?? [];
    }
    return [];
  }

  private async readMail(messageId: string): Promise<Mail2925ReadResult | null> {
    if (!this.token) {
      await this.refreshToken();
    }

    const url = `${BASE_URL}/mailv2/maildata/MailRead/mails/read?MessageID=${encodeURIComponent(messageId)}&FolderName=Inbox&IsPre=false`;
    const data = await this.requestWithRetry<{ code?: number; result?: Mail2925ReadResult }>(
      url,
      { method: 'GET', headers: this.buildHeaders(true) }
    );

    if (data.code === 200 && data.result) {
      return data.result;
    }
    return null;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    return {
      title: '2925 Mail',
      domains: [this.domain],
      defaultDomains: [this.domain],
      enableUserCreateEmail: false,
      enableUserDeleteEmail: false,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    const address = `${name}@${domain || this.domain}`;
    return {
      jwt: address,
      address,
    };
  }

  async loginAddress(address: string): Promise<{ jwt: string }> {
    return { jwt: address };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    return {
      address: jwt,
      send_balance: 0,
    };
  }

  async deleteAddress(): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const address = jwt;
    const pageCount = Math.max(limit + offset, 25);
    const allMails = await this.getMailList(1, pageCount);

    const filtered = allMails.filter(
      mail => mail.toAddress && mail.toAddress.includes(address)
    );

    const sliced = filtered.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => toRawMail(mail)),
      count: filtered.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const address = jwt;
    const pageCount = Math.max(limit + offset, 25);
    const allMails = await this.getMailList(1, pageCount);

    const filtered = allMails.filter(
      mail => mail.toAddress && mail.toAddress.includes(address)
    );

    const sliced = filtered.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => toParsedMail(mail)),
      count: filtered.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const detail = await this.readMail(mailId);
    if (!detail) return null;

    return {
      id: hashString(mailId),
      source: detail.fromAddress ?? '',
      address: jwt,
      raw: detail.bodyHtmlText,
      created_at: new Date().toISOString(),
    };
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const detail = await this.readMail(mailId);
    if (!detail) return null;

    return {
      id: hashString(mailId),
      source: detail.fromAddress ?? '',
      address: jwt,
      subject: detail.subject,
      from: detail.fromAddress,
      to: jwt,
      text: this.stripHtml(detail.bodyHtmlText),
      html: detail.bodyHtmlText,
      created_at: new Date().toISOString(),
      attachments: [],
    };
  }

  async deleteMail(): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async clearInbox(): Promise<CfSuccessResponse> {
    return { success: true };
  }
}

export class Mail2925AdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'Mail2925AdapterError';
  }
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function toRawMail(mail: Mail2925ListItem): CfRawMail {
  return {
    id: hashString(mail.messageId),
    source: mail.fromAddress ?? '',
    address: mail.toAddress?.[0] ?? '',
    raw: mail.bodyContent ?? '',
    created_at: new Date(Number(mail.createTime)).toISOString(),
  };
}

function toParsedMail(mail: Mail2925ListItem): CfParsedMail {
  return {
    id: hashString(mail.messageId),
    source: mail.fromAddress ?? '',
    address: mail.toAddress?.[0] ?? '',
    subject: mail.subject,
    from: mail.fromAddress,
    to: mail.toAddress?.[0] ?? '',
    text: mail.bodyContent,
    html: undefined,
    created_at: new Date(Number(mail.createTime)).toISOString(),
    attachments: [],
  };
}
