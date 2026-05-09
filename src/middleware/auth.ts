import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { extractBearerToken, verifyLocalJwt, type EveryMailJwtPayload } from '../utils/jwt.js';
import { wrapError } from '../utils/transformer.js';

/**
 * 认证中间件
 *
 * 支持三种认证方式（ShiroMail 客户端可能使用其中任一种）：
 * 1. X-API-Key header  → ShiroMail 的 API Key 认证
 * 2. Authorization: Bearer <everymail-jwt>  → everyMail 签发的 JWT（内嵌 CF JWT）
 * 3. Authorization: Bearer <cf-jwt>  → CF 原生 JWT（直接透传）
 */

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      /** 解码后的 everyMail JWT 载荷 */
      authPayload?: EveryMailJwtPayload;
      /** CF 后端的原始 JWT（可直接用于适配器调用） */
      cfJwt?: string;
      /** 是否通过 API Key 认证 */
      apiKeyAuth?: boolean;
    }
  }
}

/**
 * ShiroMail API Key 验证中间件
 *
 * 如果配置了 SHIROMAIL_API_KEY，则要求所有请求必须携带有效的 API Key。
 * API Key 可以通过以下方式传递：
 * - Header: X-API-Key: <key>
 * - Header: x-api-key: <key>
 * - Query: ?api_key=<key>
 */
export function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
  // 如果没有配置 API Key，直接放行
  if (!config.shiroApiKey) {
    next();
    return;
  }

  const apiKey =
    req.headers['x-api-key'] as string ??
    req.headers['x-apikey'] as string ??
    req.query.api_key as string;

  if (!apiKey || apiKey !== config.shiroApiKey) {
    res.status(401).json(wrapError('Invalid API Key. Provide X-API-Key header.'));
    return;
  }

  req.apiKeyAuth = true;
  next();
}

/**
 * 必须认证中间件 - 如果没有有效 token 则返回 401
 *
 * 优先尝试 everyMail JWT，如果失败则将原始 token 当作 CF JWT 直接使用
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json(wrapError('Authorization required. Provide Bearer token.'));
    return;
  }

  // 尝试作为 everyMail JWT 解码
  try {
    const payload = verifyLocalJwt(token);
    req.authPayload = payload;
    req.cfJwt = payload.cf_jwt;
    next();
    return;
  } catch {
    // 不是 everyMail JWT，可能是 CF 原生 JWT
  }

  // 直接当作 CF JWT 使用（透传模式）
  req.cfJwt = token;
  next();
}

/**
 * 可选认证中间件 - 有 token 就解码，没有也放行
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);

  if (token) {
    try {
      const payload = verifyLocalJwt(token);
      req.authPayload = payload;
      req.cfJwt = payload.cf_jwt;
    } catch {
      // 尝试作为 CF JWT
      req.cfJwt = token;
    }
  }

  next();
}
