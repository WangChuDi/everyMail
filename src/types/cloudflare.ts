/**
 * cloudflare_temp_email API 类型定义
 * 基于 https://github.com/dreamhunter2333/cloudflare_temp_email 源码分析
 */

// ===== 请求类型 =====

/** POST /api/new_address 请求体 */
export interface CfNewAddressRequest {
  name: string;
  domain: string;
  cf_token?: string;
  enableRandomSubdomain?: boolean;
}

/** POST /api/address_login 请求体 */
export interface CfAddressLoginRequest {
  address: string;
  password: string;
}

/** POST /api/address_change_password 请求体 */
export interface CfChangePasswordRequest {
  address: string;
  old_password: string;
  new_password: string;
}

// ===== 响应类型 =====

/** POST /api/new_address 响应 */
export interface CfNewAddressResponse {
  jwt: string;
  address: string;
  address_id?: number;
}

/** GET /open_api/settings 响应 */
export interface CfOpenSettings {
  title?: string;
  announcement?: string;
  alwaysShowAnnouncement?: boolean;
  prefix?: string;
  addressRegex?: string;
  minAddressLen?: number;
  maxAddressLen?: number;
  defaultDomains?: string[];
  domains?: string[];
  randomSubdomainDomains?: string[];
  domainLabels?: string[];
  needAuth?: boolean;
  adminContact?: string;
  enableUserCreateEmail?: boolean;
  disableAnonymousUserCreateEmail?: boolean;
  disableCustomAddressName?: boolean;
  enableUserDeleteEmail?: boolean;
  enableAutoReply?: boolean;
  enableIndexAbout?: boolean;
  copyright?: string;
  cfTurnstileSiteKey?: string;
  enableWebhook?: boolean;
  isS3Enabled?: boolean;
  enableSendMail?: boolean;
  version?: string;
  showGithub?: boolean;
  disableAdminPasswordCheck?: boolean;
  enableAddressPassword?: boolean;
  enableAgentEmailInfo?: boolean;
  smtpImapProxyConfig?: {
    smtp?: { host?: string; port?: number; starttls?: boolean };
    imap?: { host?: string; port?: number; starttls?: boolean };
  };
  statusUrl?: string;
  enableGlobalTurnstileCheck?: boolean;
}

/** GET /api/settings 响应 (需要 JWT) */
export interface CfAddressSettings {
  address: string;
  send_balance: number;
}

/** GET /api/mails 响应 */
export interface CfMailListResponse {
  results: CfRawMail[];
  count: number;
}

/** raw_mails 表行 */
export interface CfRawMail {
  id: number;
  source: string;
  address: string;
  raw: string;
  created_at: string;
  /** 可能被 gzip 压缩 */
  is_compressed?: boolean;
}

/** GET /api/parsed_mails 响应 */
export interface CfParsedMailListResponse {
  results: CfParsedMail[];
  count: number;
}

/** parsed mail */
export interface CfParsedMail {
  id: number;
  source: string;
  address: string;
  subject?: string;
  from?: string;
  to?: string;
  text?: string;
  html?: string;
  created_at: string;
  attachments?: CfAttachment[];
}

export interface CfAttachment {
  filename?: string;
  mimeType?: string;
  size?: number;
  content?: string;
}

/** 通用操作响应 */
export interface CfSuccessResponse {
  success: boolean;
}
