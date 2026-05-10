import type { Request, Response, NextFunction } from 'express';
import { wrapError } from '../utils/transformer.js';

interface AdapterError extends Error {
  statusCode?: number;
  responseBody?: string;
}

function serializeError(req: Request, statusCode: number, message: string): unknown {
  const path = req.originalUrl || req.path;

  if (path.startsWith('/shiromail')) {
    return wrapError(message, statusCode);
  }

  if (path.startsWith('/cloudmail')) {
    return { code: statusCode, message, data: null };
  }

  return { error: message };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[Error]', err.message);

  const adapterErr = err as AdapterError;
  if (adapterErr.statusCode !== undefined) {
    const statusCode = adapterErr.statusCode >= 400 && adapterErr.statusCode < 600
      ? adapterErr.statusCode
      : 502;
    if (adapterErr.responseBody) {
      console.error('[Backend Response]', adapterErr.responseBody);
    }
    res.status(statusCode).json(serializeError(req, statusCode, `Backend error (${statusCode})`));
    return;
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json(serializeError(req, 401, 'Authentication failed'));
    return;
  }

  res.status(500).json(serializeError(req, 500, 'Internal server error'));
}
