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

interface InbucketAddress {
  address?: string;
  mailbox?: string;
  domain?: string;
  host?: string;
  name?: string;
}

interface InbucketMessageListItem {
  mailbox?: string;
  id: string;
  from?: string | InbucketAddress | InbucketAddress[];
  to?: string | InbucketAddress | InbucketAddress[];
  subject?: string;
  date?: string;
  'posix-millis'?: number;
  size?: number;
  seen?: boolean;
}

interface InbucketAttachment {
  filename?: string;
  'content-type'?: string;
  'download-link'?: string;
  'view-link'?: string;
  md5?: string;
}

interface InbucketMessageBody {
  text?: string;
  html?: string;
}

interface InbucketMessageDetail extends InbucketMessageListItem {
  body?: InbucketMessageBody;
  header?: Record<string, string | string[] | undefined>;
  attachments?: InbucketAttachment[];
}

/**
 * Inbucket 后端适配器
 *
 * Inbucket 的 mailbox 是隐式存在的：邮件投递后才会出现，且无需鉴权。
 * 因此本适配器会把 address 本身当作 mailbox 标识符（兼容层里的 jwt）。
 */
export class InbucketAdapter implements BackendAdapter {
  readonly name = 'inbucket';

  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.inbucketBaseUrl;
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
      throw new InbucketAdapterError('INBUCKET_BASE_URL is required when MAIL_BACKEND=inbucket', 500, '');
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
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (options.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url.toString(), fetchOptions);

    if (!resp.ok) {
      const text = await resp.text();
      throw new InbucketAdapterError(
        `Inbucket API ${method} ${path} returned ${resp.status}: ${text}`,
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
    const domain = config.defaultDomain || 'inbucket.local';
    return {
      title: 'Inbucket',
      domains: [domain],
      defaultDomains: [domain],
      enableUserCreateEmail: true,
      enableUserDeleteEmail: true,
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    const address = `${name}@${domain}`;
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

  async deleteAddress(jwt: string): Promise<CfSuccessResponse> {
    await this.request<unknown>('DELETE', `/api/v1/mailbox/${encodeURIComponent(jwt)}`);
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const mails = await this.request<InbucketMessageListItem[]>(
      'GET',
      `/api/v1/mailbox/${encodeURIComponent(jwt)}`
    );
    const sliced = mails.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => toRawMail(mail, jwt)),
      count: mails.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const mails = await this.request<InbucketMessageListItem[]>(
      'GET',
      `/api/v1/mailbox/${encodeURIComponent(jwt)}`
    );
    const sliced = mails.slice(offset, offset + limit);

    return {
      results: sliced.map(mail => toParsedMail(mail, jwt)),
      count: mails.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    try {
      const mail = await this.request<InbucketMessageDetail>(
        'GET',
        `/api/v1/mailbox/${encodeURIComponent(jwt)}/${encodeURIComponent(mailId)}`
      );
      return toRawMail(mail, jwt);
    } catch (err) {
      if (err instanceof InbucketAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    try {
      const mail = await this.request<InbucketMessageDetail>(
        'GET',
        `/api/v1/mailbox/${encodeURIComponent(jwt)}/${encodeURIComponent(mailId)}`
      );
      return toParsedMail(mail, jwt);
    } catch (err) {
      if (err instanceof InbucketAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    await this.request<unknown>(
      'DELETE',
      `/api/v1/mailbox/${encodeURIComponent(jwt)}/${encodeURIComponent(mailId)}`
    );
    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    await this.request<unknown>('DELETE', `/api/v1/mailbox/${encodeURIComponent(jwt)}`);
    return { success: true };
  }
}

export class InbucketAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'InbucketAdapterError';
  }
}

function toRawMail(mail: InbucketMessageListItem | InbucketMessageDetail, jwt: string): CfRawMail {
  const text = 'body' in mail ? mail.body?.text ?? '' : '';
  const html = 'body' in mail ? mail.body?.html ?? '' : '';
  const raw = buildRawMailContent(mail, text, html);

  return {
    id: toNumericId(mail.id),
    source: stringifyAddresses(mail.from),
    address: jwt,
    raw,
    created_at: toIsoDate(mail['posix-millis'], mail.date),
  };
}

function toParsedMail(mail: InbucketMessageListItem | InbucketMessageDetail, jwt: string): CfParsedMail {
  const text = 'body' in mail ? mail.body?.text : undefined;
  const html = 'body' in mail ? mail.body?.html : undefined;
  const attachments = 'attachments' in mail
    ? mail.attachments?.map(attachment => ({
        filename: attachment.filename,
        mimeType: attachment['content-type'],
      }))
    : undefined;

  return {
    id: toNumericId(mail.id),
    source: stringifyAddresses(mail.from),
    address: jwt,
    subject: mail.subject,
    from: stringifyAddresses(mail.from),
    to: stringifyAddresses(mail.to) || jwt,
    text,
    html,
    created_at: toIsoDate(mail['posix-millis'], mail.date),
    attachments,
  };
}

function buildRawMailContent(
  mail: InbucketMessageListItem | InbucketMessageDetail,
  text: string,
  html: string
): string {
  if ('header' in mail || 'attachments' in mail) {
    return JSON.stringify({
      id: mail.id,
      mailbox: mail.mailbox,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      date: toIsoDate(mail['posix-millis'], mail.date),
      header: 'header' in mail ? mail.header : undefined,
      body: {
        text,
        html,
      },
      attachments: 'attachments' in mail ? mail.attachments : undefined,
    });
  }

  return mail.subject ?? '';
}

function toIsoDate(posixMillis?: number, date?: string): string {
  if (typeof posixMillis === 'number' && Number.isFinite(posixMillis)) {
    return new Date(posixMillis).toISOString();
  }

  if (date) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function stringifyAddresses(value?: string | InbucketAddress | InbucketAddress[]): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stringifySingleAddress).filter(Boolean).join(', ');
  }

  return stringifySingleAddress(value);
}

function stringifySingleAddress(value: InbucketAddress): string {
  if (value.address) {
    return value.address;
  }

  if (value.mailbox && value.host) {
    return `${value.mailbox}@${value.host}`;
  }

  if (value.mailbox && value.domain) {
    return `${value.mailbox}@${value.domain}`;
  }

  return value.name ?? value.mailbox ?? '';
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
  return Math.abs(hash);
}
