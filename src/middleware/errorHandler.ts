import type { Request, Response, NextFunction } from 'express';
import { wrapError } from '../utils/transformer.js';

interface AdapterError extends Error {
  statusCode?: number;
  responseBody?: string;
}

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

  const adapterErr = err as AdapterError;
  if (adapterErr.statusCode !== undefined) {
    const statusCode = adapterErr.statusCode >= 400 && adapterErr.statusCode < 600
      ? adapterErr.statusCode
      : 502;
    const message = adapterErr.responseBody 
      ? `Backend error: ${adapterErr.responseBody}`
      : err.message;
    res.status(statusCode).json(wrapError(message, statusCode));
    return;
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json(wrapError('Authentication failed'));
    return;
  }

  // 未知错误
  res.status(500).json(wrapError('Internal server error'));
}
