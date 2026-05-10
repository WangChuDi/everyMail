import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * JWT 工具模块
 *
 * everyMail 维护一个本地 JWT ↔ CF JWT 的映射，
 * 向 ShiroMail 前端签发自己的 JWT，内部嵌入 CF JWT 以便转发。
 */

export interface EveryMailJwtPayload {
  /** 邮箱地址 */
  address: string;
  /** CF 后端签发的原始 JWT */
  cf_jwt: string;
  /** 签发时间 */
  iat?: number;
  /** 过期时间 */
  exp?: number;
}

/**
 * 为前端签发一个 everyMail JWT，内部包含 CF JWT
 */
export function signLocalJwt(address: string, cfJwt: string): string {
  const payload: EveryMailJwtPayload = {
    address,
    cf_jwt: cfJwt,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
}

/**
 * 验证并解码 everyMail JWT
 */
export function verifyLocalJwt(token: string): EveryMailJwtPayload {
  return jwt.verify(token, config.jwtSecret) as EveryMailJwtPayload;
}

/**
 * 从 Authorization header 提取 Bearer token
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}
