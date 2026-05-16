import { Router, Request, Response, NextFunction } from 'express';
import type { FrontendFormat } from './types.js';
import type { BackendAdapter } from '../adapters/base.js';
import { config } from '../config.js';
import type { CfParsedMail, CfRawMail } from '../types/cloudflare.js';

interface OutlookEmailPlusResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

interface ClaimRandomBody {
  email_domain?: string;
  caller_id?: string;
  task_id?: string;
  provider?: string;
  project_key?: string;
}

interface ClaimReleaseBody {
  claim_token?: string;
}

interface MessageQuery {
  email?: string;
  skip?: string;
  top?: string;
}

interface OutlookEmailPlusMessageResponse {
  id: string | number;
  email_address: string;
  from_address?: string;
  to_address: string;
  subject?: string;
  content?: string;
  html_content?: string;
  raw_content?: string;
  created_at: string;
  timestamp: string;
  has_html: boolean;
  method: string;
}

export class OutlookEmailPlusFormat implements FrontendFormat {
  readonly name = 'outlookemailplus';

  readonly routePrefix = '/outlookemailplus';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    if (!config.outlookEmailPlusFrontendAuth) {
      return null;
    }

    return (req: Request, res: Response, next: NextFunction): void => {
      const apiKey = req.header('X-API-Key');
      if (apiKey !== config.outlookEmailPlusFrontendAuth) {
        res.status(401).json(wrapError('UNAUTHORIZED', 'Unauthorized'));
        return;
      }

      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.get('/api/external/health', (_req: Request, res: Response) => {
      res.json(wrapOk({ status: 'ok', backend: adapter.name }));
    });

    router.post('/api/external/pool/claim-random', async (req: Request<{}, unknown, ClaimRandomBody>, res: Response, next: NextFunction) => {
      try {
        const domain = typeof req.body.email_domain === 'string' ? req.body.email_domain : '';
        const created = await adapter.createAddress('', domain);

        res.json(wrapOk({
          account_id: created.address_id ?? toNumericId(created.address),
          email: created.address,
          email_domain: extractDomain(created.address),
          claim_token: created.jwt,
          claimed_at: new Date().toISOString(),
        }));
      } catch (error) {
        next(error);
      }
    });

    router.post('/api/external/pool/claim-release', async (req: Request<{}, unknown, ClaimReleaseBody>, res: Response, next: NextFunction) => {
      try {
        if (!req.body.claim_token) {
          res.status(400).json(wrapError('INVALID_PARAM', 'claim_token is required'));
          return;
        }

        await adapter.deleteAddress(req.body.claim_token);
        res.json(wrapOk({ released: true }));
      } catch (error) {
        next(error);
      }
    });

    router.post('/api/external/pool/claim-complete', (_req: Request, res: Response) => {
      res.json(wrapOk({ completed: true }));
    });

    router.get('/api/external/messages', async (req: Request<{}, unknown, unknown, MessageQuery>, res: Response, next: NextFunction) => {
      try {
        const email = normalizeEmail(req.query.email);
        if (!email) {
          res.status(400).json(wrapError('INVALID_PARAM', 'email is required'));
          return;
        }

        const login = await adapter.loginAddress(email, '');
        const skip = parseNonNegativeInt(req.query.skip, 0);
        const top = parsePositiveInt(req.query.top, 20);
        const result = await adapter.listParsedMails(login.jwt, top, skip);
        const emails = result.results.map(mail => mapParsedMail(mail, email));

        res.json(wrapOk({
          emails,
          count: result.count,
          has_more: skip + emails.length < result.count,
        }));
      } catch (error) {
        next(error);
      }
    });

    router.get('/api/external/messages/:messageId', async (req: Request<{ messageId: string }, unknown, unknown, MessageQuery>, res: Response, next: NextFunction) => {
      try {
        const email = normalizeEmail(req.query.email);
        if (!email) {
          res.status(400).json(wrapError('INVALID_PARAM', 'email is required'));
          return;
        }

        const login = await adapter.loginAddress(email, '');
        const mail = await adapter.getParsedMail(login.jwt, req.params.messageId);
        if (!mail) {
          res.status(404).json(wrapError('MAIL_NOT_FOUND', 'mail not found'));
          return;
        }

        res.json(wrapOk(mapParsedMail(mail, email)));
      } catch (error) {
        next(error);
      }
    });

    router.get('/api/external/messages/:messageId/raw', async (req: Request<{ messageId: string }, unknown, unknown, MessageQuery>, res: Response, next: NextFunction) => {
      try {
        const email = normalizeEmail(req.query.email);
        if (!email) {
          res.status(400).json(wrapError('INVALID_PARAM', 'email is required'));
          return;
        }

        const login = await adapter.loginAddress(email, '');
        const mail = await adapter.getMail(login.jwt, req.params.messageId);
        if (!mail) {
          res.status(404).json(wrapError('MAIL_NOT_FOUND', 'mail not found'));
          return;
        }

        res.json(wrapOk(mapRawMail(mail, email)));
      } catch (error) {
        next(error);
      }
    });
  }
}

function wrapOk<T>(data: T): OutlookEmailPlusResponse<T> {
  return { success: true, code: 'OK', message: 'success', data };
}

function wrapError(code: string, message: string): OutlookEmailPlusResponse<null> {
  return { success: false, code, message, data: null };
}

function normalizeEmail(email?: string): string {
  return email?.trim() ?? '';
}

function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf('@');
  return atIndex >= 0 ? email.slice(atIndex + 1) : '';
}

function mapParsedMail(mail: CfParsedMail, fallbackEmail: string): OutlookEmailPlusMessageResponse {
  const createdAt = normalizeDate(mail.created_at);
  const to = mail.to ?? mail.address ?? fallbackEmail;

  return {
    id: mail.id,
    email_address: to,
    from_address: mail.from ?? mail.source,
    to_address: to,
    subject: mail.subject,
    content: mail.text,
    html_content: mail.html,
    created_at: createdAt,
    timestamp: createdAt,
    has_html: !!mail.html,
    method: 'api',
  };
}

function mapRawMail(mail: CfRawMail, fallbackEmail: string): OutlookEmailPlusMessageResponse {
  const createdAt = normalizeDate(mail.created_at);

  return {
    id: mail.id,
    email_address: mail.address || fallbackEmail,
    from_address: mail.source,
    to_address: mail.address || fallbackEmail,
    raw_content: mail.raw,
    created_at: createdAt,
    timestamp: createdAt,
    has_html: false,
    method: 'api',
  };
}

function normalizeDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}

function toNumericId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}
