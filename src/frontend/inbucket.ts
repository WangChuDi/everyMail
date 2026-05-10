import type { Router, Request, Response, NextFunction } from 'express';
import type { FrontendFormat } from './types.js';
import type { BackendAdapter } from '../adapters/base.js';
import type { CfParsedMail } from '../types/cloudflare.js';

interface InbucketAttachment {
  filename: string;
  'content-type': string;
  'download-link': string;
  'view-link': string;
  md5: string;
}

interface InbucketMessage {
  mailbox: string;
  id: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  'posix-millis': number;
  size: number;
  seen: boolean;
  body: {
    text: string;
    html: string;
  };
  header: Record<string, never>;
  attachments: InbucketAttachment[];
}

function mapMail(mailbox: string, mail: CfParsedMail): InbucketMessage {
  const createdAt = new Date(mail.created_at);
  const posixMillis = createdAt.getTime();
  const text = mail.text ?? '';
  const html = mail.html ?? '';

  return {
    mailbox,
    id: String(mail.id),
    from: mail.from ?? '',
    to: mail.to ? [mail.to] : [],
    subject: mail.subject ?? '',
    date: mail.created_at,
    'posix-millis': Number.isNaN(posixMillis) ? 0 : posixMillis,
    size: text.length + html.length,
    seen: false,
    body: {
      text,
      html,
    },
    header: {},
    attachments: [],
  };
}

async function getMailboxJwt(adapter: BackendAdapter, mailbox: string): Promise<string> {
  const { jwt } = await adapter.loginAddress(mailbox, '');
  return jwt;
}

export class InbucketFormat implements FrontendFormat {
  readonly name = 'inbucket';

  readonly routePrefix = '/inbucket';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    return null;
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.get('/v1/mailbox/:name', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mailbox = req.params.name;
        const jwt = await getMailboxJwt(adapter, mailbox);
        const mails = await adapter.listParsedMails(jwt);

        res.json(mails.results.map(mail => mapMail(mailbox, mail)));
      } catch (error) {
        next(error);
      }
    });

    router.get('/v1/mailbox/:name/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mailbox = req.params.name;
        const mailId = req.params.id;
        const jwt = await getMailboxJwt(adapter, mailbox);
        const mail = await adapter.getParsedMail(jwt, mailId);

        if (!mail) {
          res.status(404).json({ error: 'message not found' });
          return;
        }

        res.json(mapMail(mailbox, mail));
      } catch (error) {
        next(error);
      }
    });

    router.delete('/v1/mailbox/:name/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mailbox = req.params.name;
        const mailId = req.params.id;
        const jwt = await getMailboxJwt(adapter, mailbox);

        await adapter.deleteMail(jwt, mailId);
        res.json('OK');
      } catch (error) {
        next(error);
      }
    });

    router.delete('/v1/mailbox/:name', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mailbox = req.params.name;
        const jwt = await getMailboxJwt(adapter, mailbox);

        await adapter.clearInbox(jwt);
        res.json('OK');
      } catch (error) {
        next(error);
      }
    });
  }
}
