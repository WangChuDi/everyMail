import { Router, Request, Response, NextFunction } from 'express';
import { FrontendFormat } from './types.js';
import { BackendAdapter } from '../adapters/base.js';
import { config } from '../config.js';
import type { CfAttachment, CfParsedMail } from '../types/cloudflare.js';

interface CloudMailWrappedResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface CloudMailAccountAddBody {
  email?: string;
}

interface CloudMailAccountDeleteBody {
  email?: string;
}

interface CloudMailAccountListQuery {
  email?: string;
  page?: string;
  pageSize?: string;
}

interface CloudMailEmailListQuery {
  email?: string;
  page?: string;
  pageSize?: string;
}

interface CloudMailEmailDeleteBody {
  email?: string;
  emailIds?: Array<string | number>;
  ids?: Array<string | number>;
  id?: string | number;
}

interface CloudMailAccountItem {
  id: string;
  email: string;
  createTime: string;
  sendBalance: number;
}

interface CloudMailEmailItem {
  id: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  createTime: string;
  attachments: CloudMailAttachmentItem[];
}

interface CloudMailAttachmentItem {
  filename: string;
  mimeType: string;
  size: number;
}

export class CloudMailFormat implements FrontendFormat {
  readonly name = 'cloudmail';

  readonly routePrefix = '/cloudmail';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    return (req: Request, res: Response, next: NextFunction): void => {
      const auth = req.header('Authorization');

      if (auth !== config.cloudmailAuth) {
        res.status(401).json(wrapResponse<null>(401, 'unauthorized', null));
        return;
      }

      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.post(
      '/account/add',
      async (
        req: Request<{}, unknown, CloudMailAccountAddBody>,
        res: Response,
        next: NextFunction
      ) => {
        try {
          const email = normalizeEmail(req.body.email);
          if (!email) {
            res.status(400).json(wrapResponse<null>(400, 'email is required', null));
            return;
          }

          const parsedEmail = splitEmail(email);
          if (!parsedEmail) {
            res.status(400).json(wrapResponse<null>(400, 'invalid email', null));
            return;
          }

          const created = await adapter.createAddress(parsedEmail.name, parsedEmail.domain);
          const account = mapAddressToCloudMailAccount(created.address_id, created.address);

          res.json(wrapResponse(200, 'success', account));
        } catch (error) {
          next(error);
        }
      }
    );

    router.get(
      '/account/list',
      async (
        req: Request<{}, unknown, unknown, CloudMailAccountListQuery>,
        res: Response,
        next: NextFunction
      ) => {
        try {
          const jwt = buildJwt(undefined, req.query.email);
          const settings = await adapter.getAddressSettings(jwt);
          const account = mapAddressToCloudMailAccount(settings.address, settings.address, settings.send_balance);
          const page = parsePage(req.query.page);
          const pageSize = parsePageSize(req.query.pageSize);
          const offset = (page - 1) * pageSize;
          const list = offset === 0 ? [account].slice(0, pageSize) : [];

          res.json(wrapResponse(200, 'success', {
            list,
            total: 1,
          }));
        } catch (error) {
          next(error);
        }
      }
    );

    router.delete(
      '/account/delete',
      async (
        req: Request<{}, unknown, CloudMailAccountDeleteBody>,
        res: Response,
        next: NextFunction
      ) => {
        try {
          const jwt = buildJwt(req.body.email, undefined);
          await adapter.deleteAddress(jwt);
          res.json(wrapResponse(200, 'success', null));
        } catch (error) {
          next(error);
        }
      }
    );

    router.get(
      '/email/list',
      async (
        req: Request<{}, unknown, unknown, CloudMailEmailListQuery>,
        res: Response,
        next: NextFunction
      ) => {
        try {
          const page = parsePage(req.query.page);
          const pageSize = parsePageSize(req.query.pageSize);
          const offset = (page - 1) * pageSize;
          const jwt = buildJwt(undefined, req.query.email);
          const result = await adapter.listParsedMails(jwt, pageSize, offset);

          res.json(wrapResponse(200, 'success', {
            list: result.results.map(mapParsedMailToCloudMailEmail),
            total: result.count,
          }));
        } catch (error) {
          next(error);
        }
      }
    );

    router.delete(
      '/email/delete',
      async (
        req: Request<{}, unknown, CloudMailEmailDeleteBody>,
        res: Response,
        next: NextFunction
      ) => {
        try {
          const jwt = buildJwt(req.body.email, undefined);
          const mailIds = collectMailIds(req.body);

          for (const mailId of mailIds) {
            await adapter.deleteMail(jwt, mailId);
          }

          res.json(wrapResponse(200, 'success', null));
        } catch (error) {
          next(error);
        }
      }
    );
  }
}

function wrapResponse<T>(code: number, message: string, data: T): CloudMailWrappedResponse<T> {
  return { code, message, data };
}

function normalizeEmail(email?: string): string {
  return email?.trim() ?? '';
}

function splitEmail(email: string): { name: string; domain: string } | null {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return null;
  }

  return {
    name: email.slice(0, atIndex),
    domain: email.slice(atIndex + 1),
  };
}

function parsePage(page?: string): number {
  const parsed = Number.parseInt(page ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function parsePageSize(pageSize?: string): number {
  const parsed = Number.parseInt(pageSize ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 20;
  }

  return parsed;
}

function buildJwt(emailFromBody?: string, emailFromQuery?: string): string {
  const normalizedBodyEmail = normalizeEmail(emailFromBody);
  const normalizedQueryEmail = normalizeEmail(emailFromQuery);
  const email = normalizedBodyEmail || normalizedQueryEmail;

  return email ? `${config.cloudmailAuth}|${email}` : config.cloudmailAuth;
}

function mapAddressToCloudMailAccount(
  idSource: string | number | undefined,
  email: string,
  sendBalance = 0
): CloudMailAccountItem {
  return {
    id: String(idSource ?? email),
    email,
    createTime: new Date().toISOString(),
    sendBalance,
  };
}

function mapParsedMailToCloudMailEmail(mail: CfParsedMail): CloudMailEmailItem {
  return {
    id: String(mail.id),
    fromEmail: mail.from ?? mail.source,
    toEmail: mail.to ?? mail.address,
    subject: mail.subject ?? '',
    text: mail.text ?? '',
    html: mail.html ?? '',
    createTime: mail.created_at,
    attachments: mapAttachments(mail.attachments),
  };
}

function mapAttachments(attachments?: CfAttachment[]): CloudMailAttachmentItem[] {
  return (attachments ?? []).map(attachment => ({
    filename: attachment.filename ?? '',
    mimeType: attachment.mimeType ?? '',
    size: attachment.size ?? 0,
  }));
}

function collectMailIds(body: CloudMailEmailDeleteBody): string[] {
  const values: Array<string | number> = [
    ...(body.emailIds ?? []),
    ...(body.ids ?? []),
  ];

  if (body.id !== undefined) {
    values.push(body.id);
  }

  return [...new Set(values.map(value => String(value)))];
}
