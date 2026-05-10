import { Router, Request, Response, NextFunction } from 'express';
import type { FrontendFormat } from './types.js';
import type { BackendAdapter } from '../adapters/base.js';
import { config } from '../config.js';
import type { CfParsedMail } from '../types/cloudflare.js';

interface MoemailGenerateRequestBody {
  name?: string;
  domain?: string;
  expiryTime?: number;
}

interface MoemailListQuery {
  cursor?: string;
  limit?: string;
}

interface MoemailMessageResponse {
  id: string;
  from_address?: string;
  to_address?: string;
  subject?: string;
  content?: string;
  html?: string;
  sent_at: number;
  received_at: number;
}

export class MoemailFormat implements FrontendFormat {
  readonly name = 'moemail';

  readonly routePrefix = '/moemail';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    if (!config.moemailAuth) {
      return null;
    }

    return (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.header('X-API-Key');

      if (apiKey !== config.moemailAuth) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.post('/api/emails/generate', async (req: Request<{}, { id: string; email: string }, MoemailGenerateRequestBody>, res: Response, next: NextFunction) => {
      try {
        const { name, domain } = req.body;

        if (!name || !domain) {
          res.status(400).json({ error: 'Missing required fields: name, domain' });
          return;
        }

        const created = await adapter.createAddress(name, domain);
        res.json({
          id: created.jwt,
          email: created.address,
        });
      } catch (error) {
        next(error);
      }
    });

    router.get('/api/emails/:emailId', async (req: Request<{ emailId: string }, { messages: MoemailMessageResponse[]; nextCursor?: string; total: number }, undefined, MoemailListQuery>, res: Response, next: NextFunction) => {
      try {
        const jwt = req.params.emailId;
        const offset = parseCursor(req.query.cursor);
        const limit = parseLimit(req.query.limit);
        const result = await adapter.listParsedMails(jwt, limit, offset);
        const messages = result.results.map(mapParsedMailToMoemailMessage);
        const nextOffset = offset + messages.length;
        const nextCursor = nextOffset < result.count ? String(nextOffset) : undefined;

        res.json({
          messages,
          nextCursor,
          total: result.count,
        });
      } catch (error) {
        next(error);
      }
    });

    router.get('/api/emails/:emailId/:messageId', async (req: Request<{ emailId: string; messageId: string }, { message: MoemailMessageResponse }, undefined, Record<string, string>>, res: Response, next: NextFunction) => {
      try {
        const jwt = req.params.emailId;
        const message = await adapter.getParsedMail(jwt, req.params.messageId);

        if (!message) {
          res.status(404).json({ error: 'Message not found' });
          return;
        }

        res.json({
          message: mapParsedMailToMoemailMessage(message),
        });
      } catch (error) {
        next(error);
      }
    });

    router.delete('/api/emails/:emailId', async (req: Request<{ emailId: string }>, res: Response, next: NextFunction) => {
      try {
        const jwt = req.params.emailId;
        await adapter.deleteAddress(jwt);
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    });

    router.delete('/api/emails/:emailId/:messageId', async (req: Request<{ emailId: string; messageId: string }>, res: Response, next: NextFunction) => {
      try {
        const jwt = req.params.emailId;
        await adapter.deleteMail(jwt, req.params.messageId);
        res.json({ success: true });
      } catch (error) {
        next(error);
      }
    });
  }
}

function mapParsedMailToMoemailMessage(mail: CfParsedMail): MoemailMessageResponse {
  const timestamp = toTimestamp(mail.created_at);

  return {
    id: String(mail.id),
    from_address: mail.from ?? mail.source,
    to_address: mail.to ?? mail.address,
    subject: mail.subject,
    content: mail.text,
    html: mail.html,
    sent_at: timestamp,
    received_at: timestamp,
  };
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseLimit(limit?: string): number {
  if (!limit) {
    return 20;
  }

  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 20;
  }

  return parsed;
}
