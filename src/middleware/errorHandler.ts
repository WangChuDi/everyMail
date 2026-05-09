import type { Request, Response, NextFunction } from 'express';
import { CloudflareAdapterError } from '../adapters/cloudflare.js';
import { wrapError } from '../utils/transformer.js';

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[Error]', err.message);

  if (err instanceof CloudflareAdapterError) {
    // CF 后端返回的错误，映射状态码
    const statusCode = err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 502;
    res.status(statusCode).json(
      wrapError(`Backend error: ${err.responseBody}`, statusCode)
    );
    return;
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json(wrapError('Authentication failed'));
    return;
  }

  // 未知错误
  res.status(500).json(wrapError('Internal server error'));
}
