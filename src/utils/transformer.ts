import type { CfRawMail, CfParsedMail, CfOpenSettings } from '../types/cloudflare.js';
import type {
  ShiroMessage,
  ShiroMailbox,
  ShiroPublicSettings,
  ShiroDomain,
  ShiroApiResponse,
  ShiroPaginatedResponse,
} from '../types/shiromail.js';

/**
 * 数据转换工具
 *
 * 将 cloudflare_temp_email 的数据格式转换为 ShiroMail 兼容格式。
 */

// ===== 邮件转换 =====

/**
 * CF 解析后邮件 → ShiroMail 消息格式
 */
export function cfParsedMailToShiroMessage(mail: CfParsedMail, mailboxId?: string): ShiroMessage {
  return {
    id: String(mail.id),
    mailbox_id: mailboxId ?? mail.address ?? '',
    from: mail.from ?? '',
    to: mail.to ?? mail.address ?? '',
    subject: mail.subject ?? '(no subject)',
    text: mail.text ?? '',
    html: mail.html ?? '',
    created_at: mail.created_at,
    read: false,
    attachments: (mail.attachments ?? []).map((att, idx) => ({
      id: `${mail.id}-att-${idx}`,
      filename: att.filename ?? `attachment-${idx}`,
      mime_type: att.mimeType ?? 'application/octet-stream',
      size: att.size ?? 0,
    })),
  };
}

/**
 * CF 原始邮件 → ShiroMail 消息格式（仅包含基础信息）
 */
export function cfRawMailToShiroMessage(mail: CfRawMail, mailboxId?: string): ShiroMessage {
  return {
    id: String(mail.id),
    mailbox_id: mailboxId ?? mail.address ?? '',
    from: mail.source ?? '',
    to: mail.address ?? '',
    subject: '(raw mail)',
    text: '',
    html: '',
    raw: mail.raw,
    created_at: mail.created_at,
    read: false,
    attachments: [],
  };
}

// ===== 邮箱转换 =====

/**
 * CF 地址信息 → ShiroMail 邮箱格式
 */
export function cfAddressToShiroMailbox(
  address: string,
  addressId?: number | string
): ShiroMailbox {
  const parts = address.split('@');
  return {
    id: String(addressId ?? address),
    address: address,
    domain: parts[1] ?? '',
    local_part: parts[0] ?? '',
    created_at: '1970-01-01T00:00:00.000Z',
    expires_at: null,
    message_count: 0,
    status: 'active',
  };
}

// ===== 设置转换 =====

/**
 * CF 公开设置 → ShiroMail 公开设置
 */
export function cfSettingsToShiroSettings(settings: CfOpenSettings): ShiroPublicSettings {
  const domains: ShiroDomain[] = (settings.domains ?? []).map((d, idx) => ({
    id: String(idx),
    name: d,
    verified: true,
    is_public: true,
  }));

  return {
    title: settings.title ?? 'everyMail',
    domains,
    max_mailbox_age: 0, // CF 没有直接对应
    max_message_size: 0,
    registration_enabled: settings.enableUserCreateEmail ?? true,
    features: {
      smtp_ingest: false,
      extraction_rules: false,
      webhooks: settings.enableWebhook ?? false,
      api_keys: false,
    },
  };
}

// ===== 响应包装 =====

/**
 * 包装为 ShiroMail 标准 API 响应格式
 */
export function wrapResponse<T>(data: T, message = 'success', code = 0): ShiroApiResponse<T> {
  return { code, message, data };
}

/**
 * 包装为 ShiroMail 分页响应格式
 */
export function wrapPaginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): ShiroApiResponse<ShiroPaginatedResponse<T>> {
  return {
    code: 0,
    message: 'success',
    data: { data, total, page, page_size: pageSize },
  };
}

/**
 * 包装错误响应
 */
export function wrapError(message: string, code = -1): ShiroApiResponse<null> {
  return { code, message, data: null };
}
