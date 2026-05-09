import { Router, Request, Response, NextFunction } from 'express';
import type { FrontendFormat } from './types.js';
import type { BackendAdapter } from '../adapters/base.js';
import { config } from '../config.js';
import type { CfParsedMail, CfParsedMailListResponse } from '../types/cloudflare.js';

interface MailpitAddress {
  Name: string;
  Address: string;
}

interface MailpitAttachment {
  PartID: number;
  FileName: string;
  ContentType: string;
  Size: number;
}

interface MailpitMessage {
  ID: string;
  MessageID: number;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Date: string;
  Tags: string[];
  Text: string;
  HTML: string;
  Size: number;
  Attachments: MailpitAttachment[];
}

interface MailpitMessageListResponse {
  total: number;
  unread: number;
  messages_count: number;
  messages_unread: number;
  start: number;
  tags: string[];
  messages: MailpitMessage[];
}

interface DeleteMessagesBody {
  IDs?: unknown;
}

export class MailpitFormat implements FrontendFormat {
  readonly name = 'mailpit';
  readonly routePrefix = '/mailpit';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    if (!config.mailpitAuth) {
      return null;
    }

    return (req: Request, res: Response, next: NextFunction): void => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Mailpit"');
        res.status(401).send('Unauthorized');
        return;
      }

      const encodedCredentials = authHeader.slice('Basic '.length);
      let decodedCredentials = '';

      try {
        decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
      } catch {
        res.setHeader('WWW-Authenticate', 'Basic realm="Mailpit"');
        res.status(401).send('Unauthorized');
        return;
      }

      if (decodedCredentials !== config.mailpitAuth) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Mailpit"');
        res.status(401).send('Unauthorized');
        return;
      }

      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.get('/v1/messages', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = await this.createGlobalInboxJwt(adapter);
        const start = this.parsePaginationValue(req.query.start);
        const limit = this.parsePaginationValue(req.query.limit);
        const list = await adapter.listParsedMails(jwt, limit, start);

        res.json(this.toMailpitMessageList(list, start));
      } catch (error) {
        next(error);
      }
    });

    router.get('/v1/search', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = await this.createGlobalInboxJwt(adapter);
        const start = this.parsePaginationValue(req.query.start);
        const limit = this.parsePaginationValue(req.query.limit);
        const list = await adapter.listParsedMails(jwt, limit, start);

        res.json(this.toMailpitMessageList(list, start));
      } catch (error) {
        next(error);
      }
    });

    router.get('/v1/message/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = await this.createGlobalInboxJwt(adapter);
        const mail = await adapter.getParsedMail(jwt, req.params.id);

        if (!mail) {
          res.status(404).json({ error: 'Message not found' });
          return;
        }

        res.json(this.toMailpitMessage(mail));
      } catch (error) {
        next(error);
      }
    });

    router.delete('/v1/messages', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = await this.createGlobalInboxJwt(adapter);
        const body = req.body as DeleteMessagesBody | undefined;
        const ids = this.parseDeleteIds(body?.IDs);

        await Promise.all(ids.map(async (id) => adapter.deleteMail(jwt, id)));

        res.json('ok');
      } catch (error) {
        next(error);
      }
    });

    router.delete('/v1/search', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = await this.createGlobalInboxJwt(adapter);
        await adapter.clearInbox(jwt);
        res.json('ok');
      } catch (error) {
        next(error);
      }
    });
  }

  private async createGlobalInboxJwt(adapter: BackendAdapter): Promise<string> {
    const { jwt } = await adapter.loginAddress('mailpit@global', '');
    return jwt;
  }

  private parsePaginationValue(value: unknown): number | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }

    return parsed;
  }

  private parseDeleteIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map((id) => String(id));
  }

  private toMailpitMessageList(list: CfParsedMailListResponse, start: number | undefined): MailpitMessageListResponse {
    return {
      total: list.count,
      unread: 0,
      messages_count: list.count,
      messages_unread: 0,
      start: start ?? 0,
      tags: [],
      messages: list.results.map((mail) => this.toMailpitMessage(mail)),
    };
  }

  private toMailpitMessage(mail: CfParsedMail): MailpitMessage {
    return {
      ID: String(mail.id),
      MessageID: mail.id,
      From: {
        Name: '',
        Address: mail.from ?? '',
      },
      To: [
        {
          Name: '',
          Address: mail.to ?? '',
        },
      ],
      Subject: mail.subject ?? '',
      Date: mail.created_at,
      Tags: [],
      Text: mail.text ?? '',
      HTML: mail.html ?? '',
      Size: 0,
      Attachments: (mail.attachments ?? []).map((attachment, index) => ({
        PartID: index,
        FileName: attachment.filename ?? '',
        ContentType: attachment.mimeType ?? '',
        Size: attachment.size ?? 0,
      })),
    };
  }
}
