import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { ImapFlow, AuthenticationFailure } from 'imapflow';
import type { FetchMessageObject, MessageAddressObject, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject, ParsedMail } from 'mailparser';
import { config } from '../config.js';
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
import type { BackendAdapter } from './base.js';

interface SmtpImapSession {
  address: string;
  user: string;
  pass: string;
}

interface ParsedTokenEnvelope {
  v: number;
  address: string;
  sessionId?: string;
  exp: number;
}

interface MailWithRaw {
  uid: number;
  raw: string;
  parsed: ParsedMail;
  internalDate?: Date | string;
}

interface StoredSession {
  session: SmtpImapSession;
  expiresAt: number;
}

const TOKEN_PREFIX = 'smtpimap.v1.';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStore = new Map<string, StoredSession>();

export class SmtpImapAdapter implements BackendAdapter {
  readonly name = 'smtp_imap';

  async getOpenSettings(): Promise<CfOpenSettings> {
    const domains = getDomains();
    return {
      title: 'SMTP/IMAP',
      domains,
      defaultDomains: domains,
      enableUserCreateEmail: this.hasSharedCredentials(),
      enableUserDeleteEmail: false,
      enableSendMail: !!config.smtpImapSmtpHost,
      enableAddressPassword: !this.hasSharedCredentials(),
      smtpImapProxyConfig: {
        smtp: config.smtpImapSmtpHost ? {
          host: config.smtpImapSmtpHost,
          port: config.smtpImapSmtpPort,
          starttls: config.smtpImapSmtpTls,
        } : undefined,
        imap: config.smtpImapImapHost ? {
          host: config.smtpImapImapHost,
          port: config.smtpImapImapPort,
          starttls: !config.smtpImapImapTls,
        } : undefined,
      },
    };
  }

  async createAddress(name: string, domain: string): Promise<CfNewAddressResponse> {
    if (!this.hasSharedCredentials()) {
      throw new SmtpImapAdapterError(
        'SMTP/IMAP cannot create remote mailboxes without SMTP_IMAP_USER and SMTP_IMAP_PASS. Use address_login with the mailbox password.',
        400
      );
    }

    const address = buildAddress(name, domain);
    return {
      jwt: this.encodeSession({ address, user: config.smtpImapUser, pass: config.smtpImapPass }),
      address,
      address_id: toNumericId(address),
    };
  }

  async loginAddress(address: string, password: string): Promise<{ jwt: string }> {
    const session = this.hasSharedCredentials()
      ? { address, user: config.smtpImapUser, pass: config.smtpImapPass }
      : { address, user: address, pass: password };

    if (!session.pass) {
      throw new SmtpImapAdapterError('Password is required for SMTP/IMAP address login', 401);
    }

    await this.verifyCredentials(session);
    return { jwt: this.encodeSession(session) };
  }

  async getAddressSettings(jwt: string): Promise<CfAddressSettings> {
    const session = this.decodeSession(jwt);
    return {
      address: session.address,
      send_balance: 0,
    };
  }

  async deleteAddress(_jwt: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async listMails(jwt: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    const session = this.decodeSession(jwt);
    const summaries = await this.fetchSummaries(session, limit, offset);
    return {
      results: summaries.items.map(message => toRawMailFromSummary(message, session.address)),
      count: summaries.count,
    };
  }

  async listParsedMails(jwt: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    const session = this.decodeSession(jwt);
    const summaries = await this.fetchSummaries(session, limit, offset);
    return {
      results: summaries.items.map(message => toParsedMailFromSummary(message, session.address)),
      count: summaries.count,
    };
  }

  async getMail(jwt: string, mailId: string): Promise<CfRawMail | null> {
    const session = this.decodeSession(jwt);
    const mail = await this.fetchRawMail(session, mailId);
    return mail ? toRawMail(mail, session.address) : null;
  }

  async getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null> {
    const session = this.decodeSession(jwt);
    const mail = await this.fetchRawMail(session, mailId);
    return mail ? toParsedMail(mail, session.address) : null;
  }

  async deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse> {
    const session = this.decodeSession(jwt);
    const uid = parseMailUid(mailId);

    await this.withClient(session, false, async client => {
      const deleted = await client.messageDelete(uid, { uid: true });
      if (!deleted) {
        throw new SmtpImapAdapterError(`IMAP message ${mailId} was not deleted`, 404);
      }
    });

    return { success: true };
  }

  async clearInbox(jwt: string): Promise<CfSuccessResponse> {
    const session = this.decodeSession(jwt);

    await this.withClient(session, false, async client => {
      const query = buildSearchQuery(session.address);
      const uids = await client.search(query, { uid: true });
      if (uids && uids.length > 0) {
        await client.messageDelete(uids, { uid: true });
      }
    });

    return { success: true };
  }

  private hasSharedCredentials(): boolean {
    return config.smtpImapUser.length > 0 && config.smtpImapPass.length > 0;
  }

  private async verifyCredentials(session: SmtpImapSession): Promise<void> {
    await this.withClient(session, true, async () => undefined);
  }

  private async fetchSummaries(
    session: SmtpImapSession,
    limit: number,
    offset: number
  ): Promise<{ items: FetchMessageObject[]; count: number }> {
    return this.withClient(session, true, async client => {
      const query = buildSearchQuery(session.address);
      const uids = await client.search(query, { uid: true });
      const allUids = uids ? [...uids].sort((a, b) => b - a) : [];
      const selectedUids = allUids.slice(offset, offset + limit);
      const items: FetchMessageObject[] = [];

      if (selectedUids.length > 0) {
        for await (const message of client.fetch(selectedUids, {
          envelope: true,
          internalDate: true,
          size: true,
          uid: true,
        }, { uid: true })) {
          items.push(message);
        }
      }

      items.sort((a, b) => b.uid - a.uid);
      return { items, count: allUids.length };
    });
  }

  private async fetchRawMail(session: SmtpImapSession, mailId: string): Promise<MailWithRaw | null> {
    const uid = parseMailUid(mailId);
    return this.withClient(session, true, async client => {
      const message = await client.fetchOne(uid, {
        envelope: true,
        internalDate: true,
        source: true,
        uid: true,
      }, { uid: true });

      if (!message || !message.source) {
        return null;
      }

      const raw = message.source.toString('utf8');
      const parsed = await simpleParser(message.source);
      return {
        uid: message.uid,
        raw,
        parsed,
        internalDate: message.internalDate,
      };
    });
  }

  private async withClient<T>(
    session: SmtpImapSession,
    readOnly: boolean,
    action: (client: ImapFlow) => Promise<T>
  ): Promise<T> {
    if (!config.smtpImapImapHost) {
      throw new SmtpImapAdapterError('SMTP_IMAP_IMAP_HOST is required when MAIL_BACKEND=smtp_imap', 500);
    }

    const client = new ImapFlow({
      host: config.smtpImapImapHost,
      port: config.smtpImapImapPort,
      secure: config.smtpImapImapTls,
      logger: false,
      auth: {
        user: session.user,
        pass: session.pass,
      },
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.smtpImapMailbox, { readOnly });
      try {
        return await action(client);
      } finally {
        lock.release();
      }
    } catch (err) {
      throw normalizeImapError(err);
    } finally {
      if (client.usable || client.authenticated) {
        try {
          await client.logout();
        } catch (err) {
          if (!(err instanceof Error)) {
            throw err;
          }
        }
      }
    }
  }

  private encodeSession(session: SmtpImapSession): string {
    const iv = randomBytes(12);
    const key = deriveTokenKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const sessionId = this.hasSharedCredentials() ? undefined : createSessionId(session, expiresAt);
    const plaintext = JSON.stringify({
      v: 1,
      address: session.address,
      sessionId,
      exp: expiresAt,
    } satisfies ParsedTokenEnvelope);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${TOKEN_PREFIX}${base64Url(Buffer.concat([iv, tag, ciphertext]))}`;
  }

  private decodeSession(token: string): SmtpImapSession {
    if (!token.startsWith(TOKEN_PREFIX)) {
      throw new SmtpImapAdapterError('Invalid SMTP/IMAP session token', 401);
    }

    const payload = Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url');
    if (payload.length < 29) {
      throw new SmtpImapAdapterError('Invalid SMTP/IMAP session token', 401);
    }

    try {
      const iv = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const ciphertext = payload.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', deriveTokenKey(), iv);
      decipher.setAuthTag(tag);
      const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(json) as unknown;

      if (!isParsedTokenEnvelope(parsed)) {
        throw new SmtpImapAdapterError('Invalid SMTP/IMAP session token payload', 401);
      }

      if (parsed.exp <= Date.now()) {
        if (parsed.sessionId) {
          sessionStore.delete(parsed.sessionId);
        }
        throw new SmtpImapAdapterError('SMTP/IMAP session expired', 401);
      }

      if (parsed.sessionId) {
        const stored = sessionStore.get(parsed.sessionId);
        if (!stored || stored.session.address !== parsed.address || stored.expiresAt <= Date.now()) {
          sessionStore.delete(parsed.sessionId);
          throw new SmtpImapAdapterError('SMTP/IMAP session expired', 401);
        }
        return stored.session;
      }

      if (!this.hasSharedCredentials()) {
        throw new SmtpImapAdapterError('SMTP/IMAP session expired', 401);
      }

      return {
        address: parsed.address,
        user: config.smtpImapUser,
        pass: config.smtpImapPass,
      };
    } catch (err) {
      if (err instanceof SmtpImapAdapterError) {
        throw err;
      }
      throw new SmtpImapAdapterError('Invalid SMTP/IMAP session token', 401, errorMessage(err));
    }
  }
}

export class SmtpImapAdapterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody = ''
  ) {
    super(message);
    this.name = 'SmtpImapAdapterError';
  }
}

function normalizeImapError(err: unknown): SmtpImapAdapterError {
  if (err instanceof SmtpImapAdapterError) {
    return err;
  }

  if (err instanceof AuthenticationFailure || hasAuthenticationFailed(err)) {
    return new SmtpImapAdapterError('SMTP/IMAP authentication failed', 401, errorMessage(err));
  }

  return new SmtpImapAdapterError(`IMAP upstream error: ${errorMessage(err)}`, 502, errorMessage(err));
}

function hasAuthenticationFailed(value: unknown): value is { authenticationFailed: true } {
  return typeof value === 'object'
    && value !== null
    && 'authenticationFailed' in value
    && value.authenticationFailed === true;
}

function buildSearchQuery(address: string): SearchObject {
  return { or: [{ to: address }, { cc: address }, { bcc: address }] };
}

function buildAddress(name: string, domain: string): string {
  if (name.includes('@')) {
    return name;
  }

  if (!name || !domain) {
    throw new SmtpImapAdapterError('Address name and domain are required', 400);
  }

  return `${name}@${domain}`;
}

function getDomains(): string[] {
  if (config.defaultDomain) {
    return [config.defaultDomain];
  }

  const mappedDomains = Object.values(config.domainMap);
  return mappedDomains.length > 0 ? mappedDomains : [];
}

function parseMailUid(mailId: string): number {
  const uid = Number.parseInt(mailId, 10);
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new SmtpImapAdapterError(`Invalid IMAP UID: ${mailId}`, 400);
  }
  return uid;
}

function toRawMailFromSummary(message: FetchMessageObject, fallbackAddress: string): CfRawMail {
  return {
    id: message.uid,
    source: formatAddressList(message.envelope?.from),
    address: formatAddressList(message.envelope?.to) || fallbackAddress,
    raw: buildRawSummary(message),
    created_at: toIsoDate(message.internalDate ?? message.envelope?.date),
  };
}

function toParsedMailFromSummary(message: FetchMessageObject, fallbackAddress: string): CfParsedMail {
  return {
    id: message.uid,
    source: formatAddressList(message.envelope?.from),
    address: formatAddressList(message.envelope?.to) || fallbackAddress,
    subject: message.envelope?.subject ?? '',
    from: formatAddressList(message.envelope?.from),
    to: formatAddressList(message.envelope?.to) || fallbackAddress,
    created_at: toIsoDate(message.internalDate ?? message.envelope?.date),
    attachments: [],
  };
}

function toRawMail(mail: MailWithRaw, fallbackAddress: string): CfRawMail {
  return {
    id: mail.uid,
    source: formatParsedAddress(mail.parsed.from),
    address: formatParsedAddress(mail.parsed.to) || fallbackAddress,
    raw: mail.raw,
    created_at: toIsoDate(mail.parsed.date ?? mail.internalDate),
  };
}

function toParsedMail(mail: MailWithRaw, fallbackAddress: string): CfParsedMail {
  return {
    id: mail.uid,
    source: formatParsedAddress(mail.parsed.from),
    address: formatParsedAddress(mail.parsed.to) || fallbackAddress,
    subject: mail.parsed.subject ?? '',
    from: formatParsedAddress(mail.parsed.from),
    to: formatParsedAddress(mail.parsed.to) || fallbackAddress,
    text: mail.parsed.text ?? '',
    html: typeof mail.parsed.html === 'string' ? mail.parsed.html : '',
    created_at: toIsoDate(mail.parsed.date ?? mail.internalDate),
    attachments: mail.parsed.attachments.map(attachment => ({
      filename: attachment.filename,
      mimeType: attachment.contentType,
      size: attachment.size,
      content: attachment.content.toString('base64'),
    })),
  };
}

function buildRawSummary(message: FetchMessageObject): string {
  return [
    `Message-ID: ${message.envelope?.messageId ?? message.uid}`,
    `From: ${formatAddressList(message.envelope?.from)}`,
    `To: ${formatAddressList(message.envelope?.to)}`,
    `Subject: ${message.envelope?.subject ?? ''}`,
    `Date: ${toIsoDate(message.internalDate ?? message.envelope?.date)}`,
    '',
  ].join('\n');
}

function formatAddressList(addresses?: MessageAddressObject[]): string {
  return (addresses ?? []).map(address => {
    if (!address.address) {
      return address.name ?? '';
    }
    return address.name ? `${address.name} <${address.address}>` : address.address;
  }).filter(Boolean).join(', ');
}

function formatParsedAddress(address?: AddressObject | AddressObject[]): string {
  if (!address) {
    return '';
  }

  if (Array.isArray(address)) {
    return address.map(item => item.text).filter(Boolean).join(', ');
  }

  return address.text;
}

function toIsoDate(value?: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function toNumericId(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  return hash.readUInt32BE(0);
}

function deriveTokenKey(): Buffer {
  return createHash('sha256').update(config.jwtSecret).digest();
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function isParsedTokenEnvelope(value: unknown): value is ParsedTokenEnvelope {
  return typeof value === 'object'
    && value !== null
    && 'v' in value
    && 'address' in value
    && 'exp' in value
    && typeof value.v === 'number'
    && typeof value.address === 'string'
    && typeof value.exp === 'number'
    && (!('sessionId' in value) || typeof value.sessionId === 'string');
}

function createSessionId(session: SmtpImapSession, expiresAt: number): string {
  pruneExpiredSessions();
  const sessionId = randomBytes(32).toString('base64url');
  sessionStore.set(sessionId, { session, expiresAt });
  return sessionId;
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, stored] of sessionStore) {
    if (stored.expiresAt <= now) {
      sessionStore.delete(sessionId);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
