/**
 * CloudMail API 类型定义
 *
 * 目标项目: https://github.com/maillab/cloud-mail
 * CloudMail 的 API 使用 { code, message, data } 包装，并通过 Authorization
 * header 传递原始 token（无 Bearer 前缀）。
 */

export interface CloudMailResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface CloudMailOpenSettings {
  title?: string;
  domains?: string[];
  domainList?: Array<string | { name?: string; domain?: string; value?: string }>;
  version?: string;
}

export interface CloudMailAccount {
  id?: string | number;
  email?: string;
  name?: string;
  account?: string;
  address?: string;
  unread?: number;
  count?: number;
  createTime?: string;
  createdAt?: string;
  created_at?: string;
  isDel?: number | string | boolean;
}

export interface CloudMailAccountList {
  list?: CloudMailAccount[];
  total?: number;
}

export interface CloudMailEmail {
  id?: string | number;
  emailId?: string | number;
  accountId?: string | number;
  from?: string;
  fromEmail?: string;
  sender?: string;
  to?: string;
  toEmail?: string;
  recipient?: string;
  subject?: string;
  text?: string;
  content?: string;
  html?: string;
  raw?: string;
  createTime?: string;
  createdAt?: string;
  created_at?: string;
  unread?: boolean | number;
  attachments?: CloudMailAttachment[];
}

export interface CloudMailAttachment {
  id?: string | number;
  filename?: string;
  name?: string;
  mimeType?: string;
  mime_type?: string;
  size?: number;
  url?: string;
}

export interface CloudMailEmailList {
  list?: CloudMailEmail[];
  total?: number;
  latestEmail?: CloudMailEmail;
}
