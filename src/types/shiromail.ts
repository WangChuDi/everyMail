/**
 * ShiroMail API 类型定义
 * 基于 https://github.com/GALIAIS/ShiroMail 项目结构推断
 *
 * ShiroMail 使用 Go/Gin 后端，模块包括:
 * auth, mailbox, message, domain, extractor, rule, portal, system, admin
 */

// ===== 通用 =====

export interface ShiroPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ShiroApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// ===== 认证 =====

export interface ShiroLoginRequest {
  email: string;
  password: string;
}

export interface ShiroRegisterRequest {
  email: string;
  password: string;
  domain?: string;
}

export interface ShiroAuthResponse {
  token: string;
  user: ShiroUser;
}

export interface ShiroUser {
  id: string;
  email: string;
  created_at: string;
}

// ===== 邮箱 =====

export interface ShiroMailbox {
  id: string;
  address: string;
  domain: string;
  local_part: string;
  created_at: string;
  expires_at: string | null;
  message_count: number;
  status: 'active' | 'expired' | 'deleted';
}

export interface ShiroCreateMailboxRequest {
  name?: string;
  domain: string;
}

export interface ShiroCreateMailboxResponse {
  mailbox: ShiroMailbox;
  token: string;
}

// ===== 消息 =====

export interface ShiroMessage {
  id: string;
  mailbox_id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  raw?: string;
  created_at: string;
  read: boolean;
  attachments: ShiroAttachment[];
}

export interface ShiroAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  url?: string;
}

// ===== 域名 =====

export interface ShiroDomain {
  id: string;
  name: string;
  verified: boolean;
  is_public: boolean;
}

// ===== 设置 =====

export interface ShiroPublicSettings {
  title: string;
  domains: ShiroDomain[];
  max_mailbox_age: number;
  max_message_size: number;
  registration_enabled: boolean;
  features: {
    smtp_ingest: boolean;
    extraction_rules: boolean;
    webhooks: boolean;
    api_keys: boolean;
  };
}

// ===== 提取结果 =====

export interface ShiroExtraction {
  id: string;
  message_id: string;
  type: 'verification_code' | 'auth_link' | 'service_link';
  value: string;
  confidence: number;
}
