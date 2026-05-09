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

/**
 * BackendAdapter 接口
 *
 * 定义了 everyMail 兼容层需要的所有后端操作。
 * 每个临时邮箱平台实现一个适配器即可接入。
 */
export interface BackendAdapter {
  /** 适配器名称（用于日志/调试） */
  readonly name: string;

  // ===== 公开接口（无需认证） =====

  /** 获取公开设置（域名列表、功能开关等） */
  getOpenSettings(): Promise<CfOpenSettings>;

  // ===== 地址管理 =====

  /** 创建新邮箱地址 */
  createAddress(name: string, domain: string): Promise<CfNewAddressResponse>;

  /** 使用密码登录已有地址 */
  loginAddress(address: string, password: string): Promise<{ jwt: string }>;

  /** 获取地址设置（需要 JWT） */
  getAddressSettings(jwt: string): Promise<CfAddressSettings>;

  /** 删除地址（需要 JWT） */
  deleteAddress(jwt: string): Promise<CfSuccessResponse>;

  // ===== 邮件操作 =====

  /** 获取邮件列表 */
  listMails(jwt: string, limit?: number, offset?: number): Promise<CfMailListResponse>;

  /** 获取解析后的邮件列表 */
  listParsedMails(jwt: string, limit?: number, offset?: number): Promise<CfParsedMailListResponse>;

  /** 获取单封原始邮件 */
  getMail(jwt: string, mailId: string): Promise<CfRawMail | null>;

  /** 获取单封解析后的邮件 */
  getParsedMail(jwt: string, mailId: string): Promise<CfParsedMail | null>;

  /** 删除单封邮件 */
  deleteMail(jwt: string, mailId: string): Promise<CfSuccessResponse>;

  /** 清空收件箱 */
  clearInbox(jwt: string): Promise<CfSuccessResponse>;
}
