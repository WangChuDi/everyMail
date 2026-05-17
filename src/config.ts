import dotenv from 'dotenv';

dotenv.config();

export type MailBackend = 'cloudflare_temp_email' | 'cloudmail' | 'shiromail' | 'inbucket' | 'mailpit' | 'moemail' | 'outlookemailplus' | 'smtp_imap';

export interface AppConfig {
  /** 监听地址 */
  host: string;
  /** 代理服务器端口 */
  port: number;

  // ===== ShiroMail 侧 =====

  /** ShiroMail API Key（客户端认证用，留空则公开） */
  shiroApiKey: string;
  /** 域名映射: ShiroMail Domain ID → CF 域名 */
  domainMap: Record<string, string>;
  /** 默认域名 */
  defaultDomain: string;

  // ===== 后端选择 =====

  /** 当前邮件后端适配器 */
  mailBackend: MailBackend;

  // ===== CF 侧 =====

  /** cloudflare_temp_email 后端 base URL */
  cfBaseUrl: string;
  /** CF 后端访问密码 (x-custom-auth) */
  cfAuth: string;

  // ===== CloudMail 侧 =====

  /** CloudMail 后端 base URL */
  cloudmailBaseUrl: string;
  /** CloudMail 后端访问凭证（如 API key/token，按具体适配器使用） */
  cloudmailAuth: string;
  /** CloudMail 前端认证 token（客户端连接 /cloudmail 路由时需要提供，默认同 CLOUDMAIL_AUTH） */
  cloudmailFrontendAuth: string;

  // ===== ShiroMail 后端侧 =====

  /** ShiroMail 后端 base URL（当 MAIL_BACKEND=shiromail 时使用） */
  shiromailBackendUrl: string;
  /** ShiroMail 后端 API Key */
  shiromailBackendApiKey: string;

  // ===== Inbucket 侧 =====

  /** Inbucket base URL */
  inbucketBaseUrl: string;

  // ===== Mailpit 侧 =====

  /** Mailpit base URL */
  mailpitBaseUrl: string;
  /** Mailpit basic auth (user:pass) */
  mailpitAuth: string;

  // ===== moemail 侧 =====

  /** moemail base URL */
  moemailBaseUrl: string;
  /** moemail auth token */
  moemailAuth: string;

  // ===== OutlookEmailPlus 侧 =====

  /** OutlookEmailPlus base URL */
  outlookEmailPlusBaseUrl: string;
  /** OutlookEmailPlus external API key */
  outlookEmailPlusAuth: string;
  /** OutlookEmailPlus pool provider filter */
  outlookEmailPlusProvider: string;
  /** OutlookEmailPlus pool caller ID */
  outlookEmailPlusCallerId: string;
  /** OutlookEmailPlus pool project key */
  outlookEmailPlusProjectKey: string;
  /** OutlookEmailPlus frontend API key */
  outlookEmailPlusFrontendAuth: string;

  // ===== SMTP/IMAP 侧 =====

  /** IMAP server host */
  smtpImapImapHost: string;
  /** IMAP server port */
  smtpImapImapPort: number;
  /** IMAP connection uses implicit TLS */
  smtpImapImapTls: boolean;
  /** SMTP server host exposed to compatible clients */
  smtpImapSmtpHost: string;
  /** SMTP server port exposed to compatible clients */
  smtpImapSmtpPort: number;
  /** SMTP connection should use STARTTLS/secure transport */
  smtpImapSmtpTls: boolean;
  /** Shared IMAP username */
  smtpImapUser: string;
  /** Shared IMAP password */
  smtpImapPass: string;
  /** IMAP mailbox folder to read */
  smtpImapMailbox: string;

  // ===== 内部 =====

  /** 本地 JWT 签名密钥 */
  jwtSecret: string;
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // ===== 前端格式 =====

  /** 启用的前端格式列表 */
  enabledFrontends: string[];

  /** CORS 允许的 origin（默认 * 允许所有） */
  corsOrigin: string;
}

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

function parseJsonObject(raw: string): Record<string, string> {
  if (!raw || raw === '{}') return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[config] Failed to parse DOMAIN_MAP JSON: ${raw}`);
    return {};
  }
}

function parseBoolean(raw: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const VALID_BACKENDS: readonly MailBackend[] = [
  'cloudflare_temp_email', 'cloudmail', 'shiromail', 'inbucket', 'mailpit', 'moemail', 'outlookemailplus', 'smtp_imap',
];

function parseMailBackend(raw: string): MailBackend {
  if (VALID_BACKENDS.includes(raw as MailBackend)) {
    return raw as MailBackend;
  }
  console.warn(`[config] Unsupported MAIL_BACKEND "${raw}", falling back to cloudflare_temp_email`);
  return 'cloudflare_temp_email';
}

const ALL_FRONTENDS = ['shiromail', 'cloudflare', 'inbucket', 'mailpit', 'moemail', 'cloudmail', 'outlookemailplus'];

function parseFrontends(raw: string): string[] {
  if (raw.trim().toLowerCase() === 'all') {
    return ALL_FRONTENDS;
  }
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const VALID_LOG_LEVELS: readonly AppConfig['logLevel'][] = ['debug', 'info', 'warn', 'error'];

function parseLogLevel(raw: string): AppConfig['logLevel'] {
  if (VALID_LOG_LEVELS.includes(raw as AppConfig['logLevel'])) {
    return raw as AppConfig['logLevel'];
  }
  console.warn(`[config] Invalid LOG_LEVEL "${raw}", falling back to "info"`);
  return 'info';
}

export function loadConfig(): AppConfig {
  const cfg: AppConfig = {
    host: getEnv('HOST', '0.0.0.0'),
    port: parseInt(getEnv('PORT', '3100'), 10),

    shiroApiKey: getEnv('SHIROMAIL_API_KEY', ''),
    domainMap: parseJsonObject(getEnv('DOMAIN_MAP', '{}')),
    defaultDomain: getEnv('DEFAULT_DOMAIN', ''),

    mailBackend: parseMailBackend(getEnv('MAIL_BACKEND', 'cloudflare_temp_email')),

    cfBaseUrl: getEnv('CF_TEMP_EMAIL_BASE_URL', 'http://localhost:8787').replace(/\/+$/, ''),
    cfAuth: getEnv('CF_TEMP_EMAIL_AUTH', ''),

    cloudmailBaseUrl: getEnv('CLOUDMAIL_BASE_URL', '').replace(/\/+$/, ''),
    cloudmailAuth: getEnv('CLOUDMAIL_AUTH', ''),
    cloudmailFrontendAuth: getEnv('CLOUDMAIL_FRONTEND_AUTH', getEnv('CLOUDMAIL_AUTH', '')),

    shiromailBackendUrl: getEnv('SHIROMAIL_BACKEND_URL', '').replace(/\/+$/, ''),
    shiromailBackendApiKey: getEnv('SHIROMAIL_BACKEND_API_KEY', ''),

    inbucketBaseUrl: getEnv('INBUCKET_BASE_URL', '').replace(/\/+$/, ''),

    mailpitBaseUrl: getEnv('MAILPIT_BASE_URL', '').replace(/\/+$/, ''),
    mailpitAuth: getEnv('MAILPIT_AUTH', ''),

    moemailBaseUrl: getEnv('MOEMAIL_BASE_URL', '').replace(/\/+$/, ''),
    moemailAuth: getEnv('MOEMAIL_AUTH', ''),

    outlookEmailPlusBaseUrl: getEnv('OUTLOOKEMAILPLUS_BASE_URL', '').replace(/\/+$/, ''),
    outlookEmailPlusAuth: getEnv('OUTLOOKEMAILPLUS_AUTH', ''),
    outlookEmailPlusProvider: getEnv('OUTLOOKEMAILPLUS_PROVIDER', 'outlook'),
    outlookEmailPlusCallerId: getEnv('OUTLOOKEMAILPLUS_CALLER_ID', 'everymail'),
    outlookEmailPlusProjectKey: getEnv('OUTLOOKEMAILPLUS_PROJECT_KEY', ''),
    outlookEmailPlusFrontendAuth: getEnv('OUTLOOKEMAILPLUS_FRONTEND_AUTH', getEnv('OUTLOOKEMAILPLUS_AUTH', '')),

    smtpImapImapHost: getEnv('SMTP_IMAP_IMAP_HOST', ''),
    smtpImapImapPort: parseInt(getEnv('SMTP_IMAP_IMAP_PORT', '993'), 10),
    smtpImapImapTls: parseBoolean(getEnv('SMTP_IMAP_IMAP_TLS', 'true')),
    smtpImapSmtpHost: getEnv('SMTP_IMAP_SMTP_HOST', ''),
    smtpImapSmtpPort: parseInt(getEnv('SMTP_IMAP_SMTP_PORT', '587'), 10),
    smtpImapSmtpTls: parseBoolean(getEnv('SMTP_IMAP_SMTP_TLS', 'true')),
    smtpImapUser: getEnv('SMTP_IMAP_USER', ''),
    smtpImapPass: getEnv('SMTP_IMAP_PASS', ''),
    smtpImapMailbox: getEnv('SMTP_IMAP_MAILBOX', 'INBOX'),

    enabledFrontends: parseFrontends(getEnv('ENABLED_FRONTENDS', 'shiromail,cloudflare')),

    corsOrigin: getEnv('CORS_ORIGIN', '*'),

    jwtSecret: getEnv('JWT_SECRET'),
    logLevel: parseLogLevel(getEnv('LOG_LEVEL', 'info')),
  };

  // 启动时打印域名映射
  const domainEntries = Object.entries(cfg.domainMap);
  if (domainEntries.length > 0) {
    console.log('[config] 域名映射:');
    for (const [id, domain] of domainEntries) {
      console.log(`  Domain ID "${id}" → ${domain}`);
    }
  }

  return cfg;
}

/**
 * 通过 ShiroMail Domain ID 查找对应的 CF 域名
 */
export function resolveDomain(domainIdOrName: string): string {
  // 1. 先尝试作为 Domain ID 在映射表中查找
  if (config.domainMap[domainIdOrName]) {
    return config.domainMap[domainIdOrName];
  }
  // 2. 如果包含 "." 则认为已经是域名，直接返回
  if (domainIdOrName.includes('.')) {
    return domainIdOrName;
  }
  // 3. 如果有默认域名，使用默认
  if (config.defaultDomain) {
    return config.defaultDomain;
  }
  // 4. 返回原值，让 CF 后端决定
  return domainIdOrName;
}

/**
 * 获取所有映射的域名列表（给 ShiroMail 前端用）
 */
export function getMappedDomains(): Array<{ id: string; name: string }> {
  return Object.entries(config.domainMap).map(([id, name]) => ({ id, name }));
}

/** 全局单例配置 */
export const config = loadConfig();
