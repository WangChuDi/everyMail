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
const MAX_CACHE_SIZE = 500;
const PAGE_SIZE = 25;

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
  createTime?: string;
}

export class Mail2925Adapter implements BackendAdapter {
  readonly name = '2925';

  private cookie: string;
  private domain: string;
  private token: string | null = null;
  private tokenRefreshPromise: Promise<boolean> | null = null;
  private idToMessageId: Map<number, string> = new Map();

  constructor(cookie?: string, domain?: string) {
    this.cookie = cookie ?? config.mail2925Cookie;
    this.domain = domain ?? config.mail2925Domain;

    if (!this.cookie) {
      throw new Mail2925AdapterError('MAIL_2925_COOKIE is required when MAIL_BACKEND=2925', 500);
    }
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
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = (async () => {
      try {
        const resp = await fetch(`${BASE_URL}/mailv2/auth/token`, {
          method: 'POST',
          headers: this.buildHeaders(false),
          body: JSON.stringify({ timeout: 5000 }),
        });

        if (!resp.ok) {
          return false;
        }

        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return false;
        }

        const data = await resp.json() as { code?: number; result?: string };
        if (data.code === 200 && data.result) {
          this.token = data.result;
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.tokenRefreshPromise = null;
      }
    })();

    return this.tokenRefreshPromise;
  }

  private async ensureToken(): Promise<void> {
    if (!this.token) {
      const ok = await this.refreshToken();
      if (!ok) {
        throw new Mail2925AdapterError('Failed to obtain token from 2925', 401);
      }
    }
  }

  private async requestWithRetry<T>(url: string, init: RequestInit): Promise<T> {
    const resp = await fetch(url, init);

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Mail2925AdapterError(`2925 API returned non-JSON response (${resp.status})`, resp.status);
    }

    const data = await resp.json() as Record<string, unknown>;

    if (data.status_code === 401 || resp.status === 401) {
      const refreshed = await this.refreshToken();
      if (!refreshed) {
        throw new Mail2925AdapterError('Cookie expired, cannot refresh token', 401);
      }
      const retryInit: RequestInit = { ...init, headers: this.buildHeaders(true) };
      const retryResp = await fetch(url, retryInit);

      const retryContentType = retryResp.headers.get('content-type') || '';
      if (!retryContentType.includes('application/json')) {
        throw new Mail2925AdapterError(`2925 API returned non-JSON after retry (${retryResp.status})`, retryResp.status);
      }

      if (!retryResp.ok) {
        throw new Mail2925AdapterError(`2925 API error after retry: ${retryResp.status}`, retryResp.status);
      }

      return (await retryResp.json()) as T;
    }

    if (!resp.ok) {
      throw new Mail2925AdapterError(`2925 API error: ${resp.status}`, resp.status);
    }

    return data as T;
  }

  private async fetchPage(pageIndex: number): Promise<Mail2925ListItem[]> {
    await this.ensureToken();

    const url = `${BASE_URL}/mailv2/maildata/MailList/mails?Folder=Inbox&FilterType=0&PageIndex=${pageIndex}&PageCount=${PAGE_SIZE}`;
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
    await this.ensureToken();

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

  private cacheMessageId(messageId: string): number {
    const id = hashString(messageId);

    if (this.idToMessageId.size >= MAX_CACHE_SIZE) {
      const firstKey = this.idToMessageId.keys().next().value;
      if (firstKey !== undefined) {
        this.idToMessageId.delete(firstKey);
      }
    }

    this.idToMessageId.set(id, messageId);
    return id;
  }

  private async resolveMessageId(numericId: number): Promise<string | null> {
    const cached = this.idToMessageId.get(numericId);
    if (cached) {
      return cached;
    }

    let pageIndex = 1;
    while (pageIndex <= 10) {
      const pageMails = await this.fetchPage(pageIndex);
      if (pageMails.length === 0) break;

      for (const mail of pageMails) {
        const id = this.cacheMessageId(mail.messageId);
        if (id === numericId) {
          return mail.messageId;
        }
      }

      if (pageMails.length < PAGE_SIZE) break;
      pageIndex += 1;
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

  private normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    return {
      title: '2925 Mail',
      domains: [this.domain],
      defaultDomains: [this.domain],
      enableUserCreateEmail: true,
      enableUserDeleteEmail: false,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    const targetDomain = domain || this.domain;

    if (this.normalizeAddress(targetDomain) !== this.normalizeAddress(this.domain)) {
      throw new Mail2925AdapterError(`Domain must be ${this.domain}`, 400);
    }

    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Mail2925AdapterError('Invalid address name: only alphanumeric, dot, underscore, or hyphen allowed', 400);
    }

    if (name.length > 64) {
      throw new Mail2925AdapterError('Invalid address name: max 64 characters', 400);
    }

    const address = `${name}@${targetDomain}`;
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
    const address = this.normalizeAddress(jwt);
    const collected: Mail2925ListItem[] = [];
    let pageIndex = 1;

    while (collected.length < offset + limit) {
      const pageMails = await this.fetchPage(pageIndex);
      if (pageMails.length === 0) break;

      for (const mail of pageMails) {
        if (mail.toAddress && mail.toAddress.some(to => this.normalizeAddress(to) === address)) {
          collected.push(mail);
        }
      }

      if (pageMails.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    const sliced = collected.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => this.toRawMail(mail)),
      count: collected.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const address = this.normalizeAddress(jwt);
    const collected: Mail2925ListItem[] = [];
    let pageIndex = 1;

    while (collected.length < offset + limit) {
      const pageMails = await this.fetchPage(pageIndex);
      if (pageMails.length === 0) break;

      for (const mail of pageMails) {
        if (mail.toAddress && mail.toAddress.some(to => this.normalizeAddress(to) === address)) {
          collected.push(mail);
        }
      }

      if (pageMails.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    const sliced = collected.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => this.toParsedMail(mail)),
      count: collected.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const numericId = Number(mailId);
    const messageId = await this.resolveMessageId(numericId);
    if (!messageId) return null;

    const detail = await this.readMail(messageId);
    if (!detail) return null;

    return {
      id: numericId,
      source: detail.fromAddress ?? '',
      address: jwt,
      raw: detail.bodyHtmlText,
      created_at: parseTimestamp(detail.createTime),
    };
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const numericId = Number(mailId);
    const messageId = await this.resolveMessageId(numericId);
    if (!messageId) return null;

    const detail = await this.readMail(messageId);
    if (!detail) return null;

    return {
      id: numericId,
      source: detail.fromAddress ?? '',
      address: jwt,
      subject: detail.subject,
      from: detail.fromAddress,
      to: jwt,
      text: this.stripHtml(detail.bodyHtmlText),
      html: detail.bodyHtmlText,
      created_at: parseTimestamp(detail.createTime),
      attachments: [],
    };
  }

  async deleteMail(): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async clearInbox(): Promise<CfSuccessResponse> {
    return { success: true };
  }

  private toRawMail(mail: Mail2925ListItem): CfRawMail {
    const id = this.cacheMessageId(mail.messageId);
    return {
      id,
      source: mail.fromAddress ?? '',
      address: mail.toAddress?.[0] ?? '',
      raw: mail.bodyContent ?? '',
      created_at: parseTimestamp(mail.createTime),
    };
  }

  private toParsedMail(mail: Mail2925ListItem): CfParsedMail {
    const id = this.cacheMessageId(mail.messageId);
    return {
      id,
      source: mail.fromAddress ?? '',
      address: mail.toAddress?.[0] ?? '',
      subject: mail.subject,
      from: mail.fromAddress,
      to: mail.toAddress?.[0] ?? '',
      text: mail.bodyContent,
      html: undefined,
      created_at: parseTimestamp(mail.createTime),
      attachments: [],
    };
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

function parseTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const num = Number(timestamp);
  if (!Number.isNaN(num) && num > 0) {
    try {
      return new Date(num).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}
