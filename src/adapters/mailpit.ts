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

interface MailpitAddress {
  Name?: string;
  Address?: string;
}

interface MailpitAttachment {
  PartID?: string;
  FileName?: string;
  ContentType?: string;
  Size?: number;
}

interface MailpitMessageSummary {
  ID: string;
  MessageID?: string;
  From?: MailpitAddress;
  To?: MailpitAddress[];
  Subject?: string;
  Date?: string;
  Tags?: string[];
  Size?: number;
}

interface MailpitMessageDetail extends MailpitMessageSummary {
  Cc?: MailpitAddress[];
  Bcc?: MailpitAddress[];
  Text?: string;
  HTML?: string;
  Inline?: MailpitAttachment[];
  Attachments?: MailpitAttachment[];
}

interface MailpitMessageListResponse {
  total?: number;
  unread?: number;
  messages_count?: number;
  messages_unread?: number;
  start?: number;
  tags?: string[];
  messages?: MailpitMessageSummary[];
}

export class MailpitAdapter implements BackendAdapter {
  readonly name = 'mailpit';

  private baseUrl: string;
  private auth: string;

  constructor(baseUrl?: string, auth?: string) {
    this.baseUrl = baseUrl ?? config.mailpitBaseUrl;
    this.auth = auth ?? config.mailpitAuth;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth) {
      headers.Authorization = `Basic ${btoa(this.auth)}`;
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
      throw new MailpitAdapterError('MAILPIT_BASE_URL is required when MAIL_BACKEND=mailpit', 500, '');
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

    if (!resp.ok) {
      const text = await resp.text();
      throw new MailpitAdapterError(
        `Mailpit API ${method} ${path} returned ${resp.status}: ${text}`,
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
    const domain = config.defaultDomain || 'mailpit.local';
    return {
      title: 'Mailpit',
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
    await this.request<unknown>('DELETE', '/api/v1/search', {
      query: { query: `to:${jwt}` },
    });
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const response = await this.request<MailpitMessageListResponse>('GET', '/api/v1/search', {
      query: {
        query: `to:${jwt}`,
        start: offset,
        limit,
      },
    });

    const results = (response.messages ?? []).map(message => toRawMail(message, jwt));
    return {
      results,
      count: response.total ?? response.messages_count ?? results.length,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const response = await this.request<MailpitMessageListResponse>('GET', '/api/v1/search', {
      query: {
        query: `to:${jwt}`,
        start: offset,
        limit,
      },
    });

    const results = (response.messages ?? []).map(message => toParsedMailFromSummary(message, jwt));
    return {
      results,
      count: response.total ?? response.messages_count ?? results.length,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    try {
      const message = await this.request<MailpitMessageDetail>('GET', `/api/v1/message/${mailId}`);
      return toRawMail(message, jwt);
    } catch (err) {
      if (err instanceof MailpitAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    try {
      const message = await this.request<MailpitMessageDetail>('GET', `/api/v1/message/${mailId}`);
      return toParsedMailFromDetail(message, jwt);
    } catch (err) {
      if (err instanceof MailpitAdapterError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    void jwt;
    await this.request<unknown>('DELETE', '/api/v1/messages', {
      body: { IDs: [mailId] },
    });
    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    await this.request<unknown>('DELETE', '/api/v1/search', {
      query: { query: `to:${jwt}` },
    });
    return { success: true };
  }
}

export class MailpitAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'MailpitAdapterError';
  }
}

function toRawMail(message: MailpitMessageSummary | MailpitMessageDetail, fallbackAddress: string): CfRawMail {
  return {
    id: hashMailpitId(message.ID),
    source: formatMailbox(message.From),
    address: firstRecipientAddress(message.To) ?? fallbackAddress,
    raw: buildRawContent(message),
    created_at: message.Date ?? new Date().toISOString(),
  };
}

function toParsedMailFromSummary(message: MailpitMessageSummary, fallbackAddress: string): CfParsedMail {
  const address = firstRecipientAddress(message.To) ?? fallbackAddress;
  return {
    id: hashMailpitId(message.ID),
    source: formatMailbox(message.From),
    address,
    subject: message.Subject,
    from: formatMailbox(message.From),
    to: formatMailboxList(message.To),
    created_at: message.Date ?? new Date().toISOString(),
    attachments: [],
  };
}

function toParsedMailFromDetail(message: MailpitMessageDetail, fallbackAddress: string): CfParsedMail {
  const address = firstRecipientAddress(message.To) ?? fallbackAddress;
  return {
    id: hashMailpitId(message.ID),
    source: formatMailbox(message.From),
    address,
    subject: message.Subject,
    from: formatMailbox(message.From),
    to: formatMailboxList(message.To),
    text: message.Text ?? '',
    html: message.HTML ?? '',
    created_at: message.Date ?? new Date().toISOString(),
    attachments: (message.Attachments ?? []).map(attachment => ({
      filename: attachment.FileName,
      mimeType: attachment.ContentType,
      size: attachment.Size,
    })),
  };
}

function formatMailbox(mailbox?: MailpitAddress): string {
  if (!mailbox?.Address) {
    return '';
  }

  return mailbox.Name ? `${mailbox.Name} <${mailbox.Address}>` : mailbox.Address;
}

function formatMailboxList(mailboxes?: MailpitAddress[]): string {
  return (mailboxes ?? []).map(formatMailbox).filter(value => value.length > 0).join(', ');
}

function firstRecipientAddress(mailboxes?: MailpitAddress[]): string | undefined {
  return mailboxes?.find(mailbox => typeof mailbox.Address === 'string' && mailbox.Address.length > 0)?.Address;
}

function buildRawContent(message: MailpitMessageSummary | MailpitMessageDetail): string {
  const lines = [
    `Message-ID: ${message.MessageID ?? message.ID}`,
    `From: ${formatMailbox(message.From)}`,
    `To: ${formatMailboxList(message.To)}`,
    `Subject: ${message.Subject ?? ''}`,
    `Date: ${message.Date ?? ''}`,
    '',
  ];

  if ('Text' in message && typeof message.Text === 'string' && message.Text.length > 0) {
    lines.push(message.Text);
  } else if ('HTML' in message && typeof message.HTML === 'string' && message.HTML.length > 0) {
    lines.push(message.HTML);
  }

  return lines.join('\n');
}

function hashMailpitId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
