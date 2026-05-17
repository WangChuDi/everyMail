import jwt from 'jsonwebtoken';
import { config, type ICloudHmeReadBackend } from '../config.js';
import type { BackendAdapter } from './base.js';
import { CloudflareAdapter } from './cloudflare.js';
import { CloudMailAdapter } from './cloudmail.js';
import { InbucketAdapter } from './inbucket.js';
import { Mail2925Adapter } from './2925.js';
import { MailpitAdapter } from './mailpit.js';
import { MoemailAdapter } from './moemail.js';
import { OutlookEmailPlusAdapter } from './outlookemailplus.js';
import { ShiroMailAdapter } from './shiromail.js';
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

interface ICloudHmeGenerateResponse {
  success?: boolean;
  result?: {
    hme?: string;
  };
  error?: string;
  reason?: string;
  message?: string;
  errors?: unknown;
}

interface ICloudHmeReserveResponse {
  success?: boolean;
  result?: unknown;
  error?: string;
  reason?: string;
  message?: string;
  errors?: unknown;
}

interface ICloudHmeListResponse {
  success?: boolean;
  result?: {
    hmeEmails?: ICloudHmeEmail[];
  };
  error?: string;
  reason?: string;
  message?: string;
  errors?: unknown;
}

interface ICloudHmeEmail {
  label?: string;
  hme?: string;
  createTimestamp?: number;
  isActive?: boolean;
}

interface ICloudHmeMailboxState {
  address: string;
  label?: string;
}

interface ICloudMailFolder {
  guid: string;
  displayName: string;
}

interface ICloudMailJsonRpcEnvelope {
  result?: unknown;
  response?: unknown;
  data?: unknown;
  error?: unknown;
  reason?: unknown;
  message?: unknown;
  responses?: unknown[];
}

interface ICloudMailMessageSummary {
  id: number;
  providerId: string;
  source: string;
  address: string;
  created_at: string;
  subject?: string;
  from?: string;
  to?: string;
  text?: string;
  html?: string;
}

interface ICloudMailMessageDetail extends ICloudMailMessageSummary {
  raw: string;
  attachments: CfParsedMail['attachments'];
}

export interface ICloudHmeReusableAlias {
  address: string;
  label: string;
  isActive: boolean;
  createdAt?: string;
  createTimestamp?: number;
}

const ICLOUD_HME_CLIENT_BUILD_NUMBER = '2536Project32';
const ICLOUD_HME_CLIENT_MASTERING_NUMBER = '2536B20';
const MESSAGE_CACHE_LIMIT = 500;
const MESSAGE_CACHE_MAILBOX_LIMIT = 200;
const MESSAGE_ID_RESOLVE_PAGE_SIZE = 50;
const MESSAGE_ID_RESOLVE_PAGE_LIMIT = 10;

export class ICloudHideMyEmailAdapter implements BackendAdapter {
  readonly name = 'icloud_hide_my_email';

  private baseUrl: string;
  private cookieHeader: string;
  private clientId: string;
  private dsid: string;
  private defaultLabel: string;
  private defaultNote: string;
  private readAdapter?: BackendAdapter;
  private useICloudWebRead: boolean;
  private resolvedInboxGuid?: string;
  private readonly providerIdCache = new Map<string, Map<number, string>>();

  constructor() {
    this.baseUrl = config.icloudHmeBaseUrl;
    this.cookieHeader = config.icloudHmeCookie;
    this.clientId = config.icloudHmeClientId;
    this.dsid = config.icloudHmeDsid;
    this.defaultLabel = config.icloudHmeDefaultLabel;
    this.defaultNote = config.icloudHmeDefaultNote;
    this.useICloudWebRead = config.icloudHmeReadBackend === 'icloud_web';
    this.readAdapter = isExternalReadBackend(config.icloudHmeReadBackend)
      ? createReadAdapter(config.icloudHmeReadBackend)
      : undefined;
  }

  async getOpenSettings(): Promise<CfOpenSettings> {
    return {
      title: 'iCloud Hide My Email',
      domains: [config.icloudWebHost],
      defaultDomains: [config.icloudWebHost],
      enableUserCreateEmail: true,
      enableUserDeleteEmail: false,
    };
  }

  async createAddress(name: string, _domain: string): Promise<CfNewAddressResponse> {
    const label = toLabel(name, this.defaultLabel);
    const generated = await this.request<ICloudHmeGenerateResponse>('POST', '/v1/hme/generate', {
      body: { langCode: 'en-us' },
    });
    const email = generated.result?.hme;

    if (!email) {
      throw new ICloudHideMyEmailAdapterError(
        'iCloud Hide My Email generate response did not include result.hme',
        502,
        JSON.stringify(generated)
      );
    }

    const reserve = await this.request<ICloudHmeReserveResponse>('POST', '/v1/hme/reserve', {
      body: {
        hme: email,
        label,
        note: this.defaultNote,
      },
    });

    if (!reserve.success) {
      throw new ICloudHideMyEmailAdapterError(
        'iCloud Hide My Email reserve request was not successful',
        502,
        JSON.stringify(reserve)
      );
    }

    return {
      jwt: encodeMailboxState({ address: email, label }),
      address: email,
    };
  }

  async loginAddress(address: string, _password = ''): Promise<{ jwt: string }> {
    const alias = await this.findReusableAlias(address);

    return {
      jwt: encodeMailboxState({ address: alias.address, label: alias.label }),
    };
  }

  async getAddressSettings(token: string): Promise<CfAddressSettings> {
    const state = decodeMailboxState(token);

    return {
      address: state.address,
      send_balance: 0,
    };
  }

  async deleteAddress(_jwt: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async listMails(token: string, limit = 20, offset = 0): Promise<CfMailListResponse> {
    if (this.useICloudWebRead) {
      const state = decodeMailboxState(token);
      const result = await this.listICloudWebMessages(state.address, limit, offset);
      return {
        results: result.messages.map(toRawMail),
        count: result.count,
      };
    }

    if (this.readAdapter) {
      const delegatedJwt = await this.loginReadBackend(token);
      return this.readAdapter.listMails(delegatedJwt, limit, offset);
    }

    return {
      results: [],
      count: 0,
    };
  }

  async listParsedMails(token: string, limit = 20, offset = 0): Promise<CfParsedMailListResponse> {
    if (this.useICloudWebRead) {
      const state = decodeMailboxState(token);
      const result = await this.listICloudWebMessages(state.address, limit, offset);
      return {
        results: result.messages.map(toParsedMail),
        count: result.count,
      };
    }

    if (this.readAdapter) {
      const delegatedJwt = await this.loginReadBackend(token);
      return this.readAdapter.listParsedMails(delegatedJwt, limit, offset);
    }

    return {
      results: [],
      count: 0,
    };
  }

  async getMail(token: string, mailId: string): Promise<CfRawMail | null> {
    if (this.useICloudWebRead) {
      const state = decodeMailboxState(token);
      const providerId = await this.resolveICloudMessageId(state.address, mailId);
      if (!providerId) {
        return null;
      }

      try {
        const message = await this.getICloudWebMessage(state.address, providerId);
        return messageBelongsToAddress(message, state.address) ? toRawMail(message) : null;
      } catch (err) {
        if (err instanceof ICloudHideMyEmailAdapterError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    }

    if (this.readAdapter) {
      const delegatedJwt = await this.loginReadBackend(token);
      return this.readAdapter.getMail(delegatedJwt, mailId);
    }

    return null;
  }

  async getParsedMail(token: string, mailId: string): Promise<CfParsedMail | null> {
    if (this.useICloudWebRead) {
      const state = decodeMailboxState(token);
      const providerId = await this.resolveICloudMessageId(state.address, mailId);
      if (!providerId) {
        return null;
      }

      try {
        const message = await this.getICloudWebMessage(state.address, providerId);
        return messageBelongsToAddress(message, state.address) ? toParsedMail(message) : null;
      } catch (err) {
        if (err instanceof ICloudHideMyEmailAdapterError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    }

    if (this.readAdapter) {
      const delegatedJwt = await this.loginReadBackend(token);
      return this.readAdapter.getParsedMail(delegatedJwt, mailId);
    }

    return null;
  }

  async deleteMail(_jwt: string, _mailId: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async clearInbox(_jwt: string): Promise<CfSuccessResponse> {
    return { success: true };
  }

  async listAliases(): Promise<ICloudHmeEmail[]> {
    const response = await this.request<ICloudHmeListResponse>('GET', '/v2/hme/list');
    return response.result?.hmeEmails ?? [];
  }

  async listReusableAliases(): Promise<ICloudHmeReusableAlias[]> {
    const aliases = await this.listAliases();
    return aliases
      .filter(alias => typeof alias.hme === 'string' && alias.hme.length > 0 && alias.isActive !== false)
      .map(alias => toReusableAlias(alias, this.defaultLabel));
  }

  async reuseAddress(address: string): Promise<CfNewAddressResponse & { label: string }> {
    const alias = await this.findReusableAlias(address);
    return {
      jwt: encodeMailboxState({ address: alias.address, label: alias.label }),
      address: alias.address,
      label: alias.label,
    };
  }

  private async findReusableAlias(address: string): Promise<ICloudHmeReusableAlias> {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) {
      throw new ICloudHideMyEmailAdapterError('Address is required for iCloud Hide My Email reuse', 400, '');
    }

    const aliases = await this.listAliases();
    const matched = aliases.find(alias => normalizeAddress(alias.hme) === normalizedAddress);

    if (!matched?.hme) {
      throw new ICloudHideMyEmailAdapterError(
        'iCloud Hide My Email alias does not belong to the configured iCloud session',
        404,
        ''
      );
    }

    if (matched.isActive === false) {
      throw new ICloudHideMyEmailAdapterError('iCloud Hide My Email alias is inactive and cannot be reused', 403, '');
    }

    return toReusableAlias(matched, this.defaultLabel);
  }

  private async loginReadBackend(token: string): Promise<string> {
    if (!this.readAdapter) {
      throw new ICloudHideMyEmailAdapterError('ICLOUD_HME_READ_BACKEND is not configured', 500, '');
    }

    const state = decodeMailboxState(token);
    const result = await this.readAdapter.loginAddress(state.address, '');
    return result.jwt;
  }

  private async listICloudWebMessages(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ messages: ICloudMailMessageSummary[]; count: number }> {
    const folderGuid = await this.resolveICloudMailInboxGuid();
    const normalizedLimit = Math.max(1, limit);
    const normalizedOffset = Math.max(0, offset);
    const payload = await this.mailRequest('/wm/message', 'list', {
      guid: folderGuid,
      sorttype: 'Date',
      sortorder: 'descending',
      requesttype: 'index',
      selected: normalizedOffset,
      count: normalizedLimit,
      rollbackslot: '0.0',
    });

    const messages = extractICloudMessageCandidates(payload)
      .map(candidate => toICloudMailMessageSummary(candidate, address))
      .filter((message): message is ICloudMailMessageSummary => message !== null)
      .filter(message => messageBelongsToAddress(message, address));

    this.rememberProviderIds(address, messages);

    return {
      messages,
      count: extractICloudMessageCount(payload, normalizedOffset + messages.length),
    };
  }

  private async getICloudWebMessage(address: string, providerId: string): Promise<ICloudMailMessageDetail> {
    const payload = await this.mailRequest('/wm/message', 'get', {
      guid: providerId,
      parts: ['HEADER', 'TEXT', 'HTML', 'ATTACHMENTS', 'STRUCTURE'],
    });

    const message = toICloudMailMessageDetail(payload, address, providerId);
    if (!message) {
      throw new ICloudHideMyEmailAdapterError(
        'iCloud Mail WebService get did not include a recognized message payload',
        404,
        stringifyUnknown(payload) ?? ''
      );
    }

    this.rememberProviderIds(address, [message]);
    return message;
  }

  private async resolveICloudMessageId(address: string, mailId: string): Promise<string | null> {
    const numericId = Number.parseInt(mailId, 10);
    if (Number.isNaN(numericId)) {
      return mailId;
    }

    const cached = this.getCachedProviderId(address, numericId);
    if (cached) {
      return cached;
    }

    for (let page = 0; page < MESSAGE_ID_RESOLVE_PAGE_LIMIT; page += 1) {
      const offset = page * MESSAGE_ID_RESOLVE_PAGE_SIZE;
      const result = await this.listICloudWebMessages(address, MESSAGE_ID_RESOLVE_PAGE_SIZE, offset);
      const resolved = this.getCachedProviderId(address, numericId);
      if (resolved) {
        return resolved;
      }
      if (result.messages.length < MESSAGE_ID_RESOLVE_PAGE_SIZE || offset + result.messages.length >= result.count) {
        break;
      }
    }

    return null;
  }

  private async resolveICloudMailInboxGuid(): Promise<string> {
    if (config.icloudMailFolderGuid.trim()) {
      return config.icloudMailFolderGuid.trim();
    }

    if (this.resolvedInboxGuid) {
      return this.resolvedInboxGuid;
    }

    const payload = await this.mailRequest('/wm/folder', 'list', {});
    const folder = selectInboxFolder(payload);
    if (!folder) {
      throw new ICloudHideMyEmailAdapterError(
        'iCloud Mail WebService folder list did not include an Inbox-like folder GUID',
        502,
        stringifyUnknown(payload) ?? ''
      );
    }

    this.resolvedInboxGuid = folder.guid;
    return folder.guid;
  }

  private rememberProviderIds(address: string, messages: Array<Pick<ICloudMailMessageSummary, 'id' | 'providerId'>>): void {
    if (messages.length === 0) {
      return;
    }

    const cache = this.getProviderIdCache(address);
    for (const message of messages) {
      cache.delete(message.id);
      cache.set(message.id, message.providerId);
    }

    trimMapToLimit(cache, MESSAGE_CACHE_LIMIT);
  }

  private getCachedProviderId(address: string, numericId: number): string | undefined {
    const cache = this.providerIdCache.get(address);
    if (!cache) {
      return undefined;
    }

    this.providerIdCache.delete(address);
    this.providerIdCache.set(address, cache);

    const providerId = cache.get(numericId);
    if (!providerId) {
      return undefined;
    }

    cache.delete(numericId);
    cache.set(numericId, providerId);
    return providerId;
  }

  private getProviderIdCache(address: string): Map<number, string> {
    const existing = this.providerIdCache.get(address);
    if (existing) {
      this.providerIdCache.delete(address);
      this.providerIdCache.set(address, existing);
      return existing;
    }

    const created = new Map<number, string>();
    this.providerIdCache.set(address, created);
    trimMapToLimit(this.providerIdCache, MESSAGE_CACHE_MAILBOX_LIMIT);
    return created;
  }

  private async mailRequest(path: '/wm/folder' | '/wm/message', method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!config.icloudMailBaseUrl) {
      throw new ICloudHideMyEmailAdapterError('ICLOUD_MAIL_BASE_URL is required when ICLOUD_HME_READ_BACKEND=icloud_web', 500, '');
    }

    if (!this.cookieHeader) {
      throw new ICloudHideMyEmailAdapterError('ICLOUD_HME_COOKIE is required when ICLOUD_HME_READ_BACKEND=icloud_web', 500, '');
    }

    const url = new URL(path, config.icloudMailBaseUrl);
    url.searchParams.set('clientBuildNumber', config.icloudMailClientBuildNumber);
    url.searchParams.set('clientMasteringNumber', config.icloudMailClientMasteringNumber);
    url.searchParams.set('clientId', this.clientId);
    url.searchParams.set('dsid', this.dsid);

    const webOrigin = `https://www.${config.icloudWebHost}`;
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: this.cookieHeader,
        Origin: webOrigin,
        Referer: `${webOrigin}/mail/`,
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}/1`,
        method,
        params,
      }),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const bodyText = await response.text();
    const parsed = contentType.includes('application/json') && bodyText
      ? parseJsonBody(bodyText, `iCloud Mail WebService POST ${path}`)
      : bodyText;

    if (!response.ok) {
      throw new ICloudHideMyEmailAdapterError(
        `iCloud Mail WebService POST ${path} returned ${response.status}`,
        mapICloudHttpStatus(response.status),
        redactSensitiveBody(bodyText, this.cookieHeader)
      );
    }

    const rpcError = extractICloudRpcError(parsed);
    if (rpcError) {
      throw new ICloudHideMyEmailAdapterError(
        `iCloud Mail WebService POST ${path} failed: ${rpcError.message}`,
        rpcError.statusCode,
        redactSensitiveBody(bodyText, this.cookieHeader)
      );
    }

    return unwrapICloudRpcPayload(parsed);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown } = {}
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new ICloudHideMyEmailAdapterError(
        'ICLOUD_HME_BASE_URL is required when MAIL_BACKEND=icloud_hide_my_email',
        500,
        ''
      );
    }

    if (!this.cookieHeader) {
      throw new ICloudHideMyEmailAdapterError(
        'ICLOUD_HME_COOKIE is required when MAIL_BACKEND=icloud_hide_my_email',
        500,
        ''
      );
    }

    const url = new URL(path, this.baseUrl);
    url.searchParams.set('clientBuildNumber', ICLOUD_HME_CLIENT_BUILD_NUMBER);
    url.searchParams.set('clientMasteringNumber', ICLOUD_HME_CLIENT_MASTERING_NUMBER);
    url.searchParams.set('clientId', this.clientId);
    url.searchParams.set('dsid', this.dsid);

    const webOrigin = `https://www.${config.icloudWebHost}`;
    const headers: Record<string, string> = {
      Accept: '*/*',
      Cookie: this.cookieHeader,
      Origin: webOrigin,
      Referer: `${webOrigin}/`,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'text/plain';
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const bodyText = await response.text();
    const parsed = contentType.includes('application/json') && bodyText
      ? parseJsonBody(bodyText, `iCloud Hide My Email API ${method} ${path}`)
      : bodyText;

    if (!response.ok) {
      throw new ICloudHideMyEmailAdapterError(
        `iCloud Hide My Email API ${method} ${path} returned ${response.status}`,
        mapICloudHttpStatus(response.status),
        redactSensitiveBody(bodyText, this.cookieHeader)
      );
    }

    if (isFailureResponse(parsed)) {
      throw new ICloudHideMyEmailAdapterError(
        buildFailureMessage(method, path, parsed),
        mapICloudFailureStatus(parsed),
        redactSensitiveBody(bodyText, this.cookieHeader)
      );
    }

    return parsed as T;
  }
}

function isExternalReadBackend(backend: ICloudHmeReadBackend | ''): backend is Exclude<ICloudHmeReadBackend, 'icloud_web'> {
  return backend !== '' && backend !== 'icloud_web';
}

function createReadAdapter(backend: Exclude<ICloudHmeReadBackend, 'icloud_web'>): BackendAdapter {
  switch (backend) {
    case 'cloudflare_temp_email':
      return new CloudflareAdapter();
    case 'cloudmail':
      return new CloudMailAdapter();
    case 'shiromail':
      return new ShiroMailAdapter();
    case 'inbucket':
      return new InbucketAdapter();
    case 'mailpit':
      return new MailpitAdapter();
    case 'moemail':
      return new MoemailAdapter();
    case 'outlookemailplus':
      return new OutlookEmailPlusAdapter();
    case '2925':
      return new Mail2925Adapter();
    default: {
      const exhaustive: never = backend;
      throw new Error(`Unsupported iCloud HME read backend: ${exhaustive}`);
    }
  }
}

export class ICloudHideMyEmailAdapterError extends Error {
  public responseBody: string;

  constructor(
    message: string,
    public statusCode: number,
    responseBody: string
  ) {
    super(message);
    this.name = 'ICloudHideMyEmailAdapterError';
    this.responseBody = redactSensitiveBody(responseBody);
  }
}

function encodeMailboxState(state: ICloudHmeMailboxState): string {
  return jwt.sign(state, config.jwtSecret, { expiresIn: '24h' });
}

function decodeMailboxState(token: string): ICloudHmeMailboxState {
  try {
    const verified = jwt.verify(token, config.jwtSecret);
    if (isMailboxState(verified)) {
      return verified;
    }
  } catch (err) {
    if (err instanceof Error) {
      throw new ICloudHideMyEmailAdapterError('Invalid iCloud Hide My Email mailbox token', 401, '');
    }

    throw err;
  }

  throw new ICloudHideMyEmailAdapterError('Invalid iCloud Hide My Email mailbox token', 401, '');
}

function isMailboxState(value: unknown): value is ICloudHmeMailboxState {
  return typeof value === 'object'
    && value !== null
    && 'address' in value
    && typeof value.address === 'string';
}

function toLabel(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed || fallback;
}

function normalizeAddress(address?: string): string {
  return address?.trim().toLowerCase() ?? '';
}

function toReusableAlias(alias: ICloudHmeEmail, defaultLabel: string): ICloudHmeReusableAlias {
  const timestamp = alias.createTimestamp;
  const createdAt = typeof timestamp === 'number' && timestamp > 0
    ? new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp).toISOString()
    : undefined;

  return {
    address: alias.hme ?? '',
    label: toLabel(alias.label ?? '', defaultLabel),
    isActive: alias.isActive !== false,
    createdAt,
    createTimestamp: timestamp,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getOwn(value: unknown, key: string): unknown {
  const record = asRecord(value);
  return record ? record[key] : undefined;
}

function getStringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStringFromPaths(value: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    const found = getStringValue(candidate);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function getNumberFromPaths(value: unknown, paths: string[][]): number | undefined {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    const found = getNumberValue(candidate);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    current = getOwn(current, key);
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

function getArrayFromPaths(value: unknown, paths: string[][]): unknown[] {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function collectRecordValues(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) {
      continue;
    }

    if (typeof current !== 'object' || current === null) {
      continue;
    }

    visited.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    records.push(current as Record<string, unknown>);
    for (const nested of Object.values(current)) {
      if (typeof nested === 'object' && nested !== null) {
        queue.push(nested);
      }
    }
  }

  return records;
}

function selectInboxFolder(value: unknown): ICloudMailFolder | null {
  const folders = getArrayFromPaths(value, [
    ['folders'],
    ['folder'],
    ['items'],
    ['data', 'folders'],
    ['result', 'folders'],
  ]);

  const candidates = (folders.length > 0 ? folders : collectRecordValues(value))
    .map(toICloudFolder)
    .filter((folder): folder is ICloudMailFolder => folder !== null);

  const inbox = candidates.find(folder => isInboxLike(folder.displayName));
  return inbox ?? candidates[0] ?? null;
}

function toICloudFolder(value: unknown): ICloudMailFolder | null {
  const guid = getStringFromPaths(value, [['guid'], ['folderGuid'], ['folderGUID'], ['id']]);
  const displayName = getStringFromPaths(value, [['displayName'], ['name'], ['localizedName'], ['folderName'], ['type'], ['role']]);
  if (!guid || !displayName) {
    return null;
  }

  return { guid, displayName };
}

function isInboxLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'inbox'
    || normalized === 'inboxfolder'
    || normalized.includes('inbox')
    || normalized === '收件箱';
}

function extractICloudMessageCandidates(value: unknown): unknown[] {
  const direct = getArrayFromPaths(value, [
    ['messages'],
    ['items'],
    ['message'],
    ['emails'],
    ['data', 'messages'],
    ['result', 'messages'],
  ]);

  if (direct.length > 0) {
    return direct;
  }

  const record = asRecord(value);
  if (record && getStringFromPaths(record, [['guid'], ['messageId'], ['id']])) {
    return [value];
  }

  return collectRecordValues(value).filter(record => {
    const type = (getStringFromPaths(record, [['type'], ['recordType']]) ?? '').toLowerCase();
    return type.includes('message')
      || getStringFromPaths(record, [['subject']]) !== undefined
      || getStringFromPaths(record, [['from'], ['sender']]) !== undefined;
  });
}

function extractICloudMessageCount(value: unknown, fallback: number): number {
  return getNumberFromPaths(value, [
    ['total'],
    ['totalCount'],
    ['messageCount'],
    ['messagesCount'],
    ['data', 'total'],
    ['result', 'total'],
  ]) ?? fallback;
}

function toICloudMailMessageSummary(value: unknown, fallbackAddress: string): ICloudMailMessageSummary | null {
  const providerId = getStringFromPaths(value, [['guid'], ['messageGuid'], ['messageId'], ['id']]);
  if (!providerId) {
    return null;
  }

  const from = formatAddressValue(getNestedValue(value, ['from']))
    ?? formatAddressValue(getNestedValue(value, ['sender']))
    ?? getStringFromPaths(value, [['fromAddress']]);
  const to = formatAddressList(getNestedValue(value, ['to']))
    ?? formatAddressList(getNestedValue(value, ['recipients']))
    ?? formatAddressList(getNestedValue(value, ['toRecipients']))
    ?? getStringFromPaths(value, [['to']]);
  const address = extractFirstAddress(getNestedValue(value, ['to']))
    ?? extractFirstAddress(getNestedValue(value, ['recipients']))
    ?? extractFirstAddress(getNestedValue(value, ['toRecipients']))
    ?? fallbackAddress;

  return {
    id: numericIdFromGuid(providerId),
    providerId,
    source: from ?? '',
    address,
    created_at: extractCreatedAt(value),
    subject: getStringFromPaths(value, [['subject'], ['title']]),
    from,
    to: to ?? address,
    text: extractBody(value, [['text'], ['textBody'], ['plainText'], ['plainTextBody'], ['bodyText'], ['body', 'text']]),
    html: extractBody(value, [['html'], ['htmlBody'], ['bodyHtml'], ['body', 'html']]),
  };
}

function toICloudMailMessageDetail(value: unknown, fallbackAddress: string, fallbackProviderId: string): ICloudMailMessageDetail | null {
  const summary = toICloudMailMessageSummary(value, fallbackAddress)
    ?? toICloudMailMessageSummary({ guid: fallbackProviderId }, fallbackAddress);
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    providerId: getStringFromPaths(value, [['guid'], ['messageGuid'], ['messageId'], ['id']]) ?? fallbackProviderId,
    id: numericIdFromGuid(getStringFromPaths(value, [['guid'], ['messageGuid'], ['messageId'], ['id']]) ?? fallbackProviderId),
    raw: buildRawContent(value, summary),
    attachments: extractAttachments(value),
  };
}

function extractBody(value: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    const stringValue = getStringValue(candidate);
    if (stringValue) {
      return stringValue;
    }

    if (Array.isArray(candidate)) {
      const joined = candidate
        .map(entry => getStringValue(entry) ?? getStringFromPaths(entry, [['content'], ['body'], ['text'], ['value']]))
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        .join('\n');
      if (joined) {
        return joined;
      }
    }
  }

  const parts = getOwn(value, 'parts');
  if (Array.isArray(parts)) {
    const joined = parts
      .map(entry => getStringFromPaths(entry, [['content'], ['body'], ['text'], ['value']]))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .join('\n');
    if (joined) {
      return joined;
    }
  }

  return undefined;
}

function extractAttachments(value: unknown): CfParsedMail['attachments'] {
  const attachments = getArrayFromPaths(value, [
    ['attachments'],
    ['body', 'attachments'],
    ['messageBody', 'attachments'],
  ]);

  return attachments.map(attachment => ({
    filename: getStringFromPaths(attachment, [['filename'], ['fileName'], ['name']]),
    mimeType: getStringFromPaths(attachment, [['mimeType'], ['contentType'], ['type']]),
    size: getNumberFromPaths(attachment, [['size'], ['length']]),
  }));
}

function extractCreatedAt(value: unknown): string {
  const dateString = getStringFromPaths(value, [['date'], ['sentDate'], ['receivedDate'], ['createdAt'], ['created_at']]);
  if (dateString) {
    const parsed = new Date(dateString);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const timestamp = getNumberFromPaths(value, [['date'], ['sentDate'], ['receivedDate'], ['timestamp'], ['createdAt'], ['created_at']]);
  if (timestamp !== undefined) {
    const millis = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function extractFirstAddress(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractFirstAddress(entry);
      if (extracted) {
        return extracted;
      }
    }
    return undefined;
  }

  return getStringFromPaths(value, [['emailAddress'], ['address'], ['email'], ['mailbox'], ['value']])
    ?? getStringValue(value);
}

function formatAddressList(value: unknown): string | undefined {
  const values: string[] = [];
  collectAddressValues(value, values);
  return values.length > 0 ? values.join(', ') : undefined;
}

function collectAddressValues(value: unknown, values: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAddressValues(entry, values);
    }
    return;
  }

  const formatted = formatAddressValue(value);
  if (formatted) {
    values.push(formatted);
  }
}

function formatAddressValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  const email = getStringFromPaths(value, [['emailAddress'], ['address'], ['email'], ['mailbox']]);
  const name = getStringFromPaths(value, [['name'], ['displayName'], ['label'], ['fullName']]);
  if (email && name) {
    return `${name} <${email}>`;
  }

  return email ?? name;
}

function buildRawContent(payload: unknown, summary: ICloudMailMessageSummary): string {
  const text = extractBody(payload, [['text'], ['textBody'], ['plainText'], ['plainTextBody'], ['bodyText'], ['body', 'text']]);
  const html = extractBody(payload, [['html'], ['htmlBody'], ['bodyHtml'], ['body', 'html']]);
  const lines = [
    `From: ${summary.from ?? summary.source}`,
    `To: ${summary.to ?? summary.address}`,
    `Subject: ${summary.subject ?? ''}`,
    `Date: ${summary.created_at}`,
    '',
  ];

  if (text) {
    lines.push(text);
  } else if (html) {
    lines.push(html);
  } else {
    lines.push(stringifyUnknown(payload) ?? '');
  }

  return lines.join('\n');
}

function toRawMail(message: ICloudMailMessageSummary | ICloudMailMessageDetail): CfRawMail {
  return {
    id: message.id,
    source: message.source,
    address: message.address,
    raw: 'raw' in message ? message.raw : buildRawContent(message, message),
    created_at: message.created_at,
  };
}

function toParsedMail(message: ICloudMailMessageSummary | ICloudMailMessageDetail): CfParsedMail {
  return {
    id: message.id,
    source: message.source,
    address: message.address,
    subject: message.subject,
    from: message.from,
    to: message.to,
    text: message.text,
    html: message.html,
    created_at: message.created_at,
    attachments: 'attachments' in message ? message.attachments : [],
  };
}

function messageBelongsToAddress(message: ICloudMailMessageSummary | ICloudMailMessageDetail, address: string): boolean {
  const normalizedAddress = normalizeAddress(address);
  const haystack = [
    message.address,
    message.to,
    message.from,
    message.subject,
    'raw' in message ? message.raw : undefined,
  ]
    .filter((entry): entry is string => typeof entry === 'string')
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedAddress);
}

function parseJsonBody(bodyText: string, context: string): unknown {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch (err) {
    if (err instanceof Error) {
      throw new ICloudHideMyEmailAdapterError(`${context} returned invalid JSON: ${err.message}`, 502, bodyText);
    }

    throw err;
  }
}

function unwrapICloudRpcPayload(value: unknown): unknown {
  const envelope = asRecord(value) as ICloudMailJsonRpcEnvelope | undefined;
  if (!envelope) {
    return value;
  }

  if (Array.isArray(envelope.responses) && envelope.responses.length > 0) {
    const first = asRecord(envelope.responses[0]);
    if (first) {
      return first.result ?? first.response ?? first.data ?? envelope.responses[0];
    }
  }

  return envelope.result ?? envelope.response ?? envelope.data ?? value;
}

function extractICloudRpcError(value: unknown): { message: string; statusCode: number } | null {
  const envelope = asRecord(value) as ICloudMailJsonRpcEnvelope | undefined;
  if (!envelope) {
    return null;
  }

  const directError = stringifyUnknown(envelope.error)
    ?? stringifyUnknown(envelope.reason)
    ?? stringifyUnknown(envelope.message);
  if (directError && directError.toLowerCase() !== 'success') {
    return {
      message: directError,
      statusCode: mapICloudFailureStatus({ message: directError }),
    };
  }

  if (Array.isArray(envelope.responses)) {
    for (const entry of envelope.responses) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }

      const status = getNumberValue(record.status);
      const message = stringifyUnknown(record.error)
        ?? stringifyUnknown(record.reason)
        ?? stringifyUnknown(record.message);

      if ((status !== undefined && status !== 0) || (message && message.toLowerCase() !== 'success')) {
        return {
          message: message ?? `RPC status ${status ?? 'unknown'}`,
          statusCode: status === 404 ? 404 : mapICloudFailureStatus({ message: message ?? String(status ?? '') }),
        };
      }
    }
  }

  return null;
}

function isFailureResponse(value: unknown): value is {
  success?: boolean;
  error?: string;
  reason?: string;
  message?: string;
  errors?: unknown;
} {
  const candidate = asRecord(value);
  if (!candidate) {
    return false;
  }

  if (candidate.success === false) {
    return true;
  }

  return typeof candidate.error === 'string'
    || typeof candidate.reason === 'string'
    || (typeof candidate.message === 'string' && candidate.message.toLowerCase() !== 'success');
}

function buildFailureMessage(
  method: string,
  path: string,
  failure: {
    error?: string;
    reason?: string;
    message?: string;
    errors?: unknown;
  }
): string {
  const detail = failure.error
    ?? failure.reason
    ?? failure.message
    ?? (failure.errors !== undefined ? JSON.stringify(failure.errors) : 'Unknown iCloud Hide My Email API failure');

  return `iCloud Hide My Email API ${method} ${path} failed: ${detail}`;
}

function mapICloudHttpStatus(statusCode: number): number {
  if (statusCode === 400) {
    return 400;
  }

  if (statusCode === 401 || statusCode === 403) {
    return 401;
  }

  if (statusCode === 404) {
    return 404;
  }

  if (statusCode === 429) {
    return 429;
  }

  return 502;
}

function mapICloudFailureStatus(failure: {
  error?: string;
  reason?: string;
  message?: string;
  errors?: unknown;
}): number {
  const details = [
    failure.error,
    failure.reason,
    failure.message,
    stringifyUnknown(failure.errors),
  ]
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .join(' ')
    .toLowerCase();

  if (details.includes('not found')) {
    return 404;
  }

  if (details.includes('unauthorized') || details.includes('forbidden') || details.includes('auth') || details.includes('cookie')) {
    return 401;
  }

  if (details.includes('rate') || details.includes('too many')) {
    return 429;
  }

  if (details.includes('bad request') || details.includes('invalid') || details.includes('missing')) {
    return 400;
  }

  return 502;
}

function numericIdFromGuid(guid: string): number {
  let hash = 0;
  for (let index = 0; index < guid.length; index += 1) {
    hash = ((hash << 5) - hash + guid.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) || 1;
}

function trimMapToLimit<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function redactSensitiveBody(body: string, cookieHeader?: string): string {
  if (!body) {
    return body;
  }

  let redacted = body;
  const cookie = cookieHeader?.trim();
  if (cookie) {
    redacted = redacted.split(cookie).join('[redacted-cookie]');
  }

  return redacted.replace(
    /(["']?(?:set-cookie|cookie)["']?\s*[:=]\s*)(["'])?[^"'\r\n,}]*(\2)?/gi,
    '$1$2[redacted]$2'
  );
}
