import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function shouldLog(level: keyof typeof LOG_LEVELS): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.logLevel];
}

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    if (statusCode >= 400 && shouldLog('warn')) {
      console.warn(`[${method}] ${originalUrl} → ${statusCode} (${duration}ms)`);
    } else if (shouldLog('info')) {
      console.log(`[${method}] ${originalUrl} → ${statusCode} (${duration}ms)`);
    }
  });

  next();
}
