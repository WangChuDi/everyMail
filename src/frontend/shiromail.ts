import { Router, Request, Response, NextFunction } from 'express';
import type { FrontendFormat } from './types.js';
import type { BackendAdapter } from '../adapters/base.js';
import { config, resolveDomain } from '../config.js';
import { signLocalJwt } from '../utils/jwt.js';
import {
  wrapResponse,
  wrapPaginated,
  wrapError,
  cfAddressToShiroMailbox,
  cfParsedMailToShiroMessage,
  cfRawMailToShiroMessage,
  cfSettingsToShiroSettings,
} from '../utils/transformer.js';
import { requireAuth } from '../middleware/auth.js';

export class ShiroMailFormat implements FrontendFormat {
  readonly name = 'shiromail';
  readonly routePrefix = '/shiromail';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    if (!config.shiroApiKey) {
      return null;
    }
    return (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.header('x-api-key') || (req.query.api_key as string);
      if (apiKey !== config.shiroApiKey) {
        res.status(401).json(wrapError('Unauthorized'));
        return;
      }
      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.post('/auth/register', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, name, domain, domain_id } = req.body;

        let addrName: string;
        let addrDomain: string;

        if (email && email.includes('@')) {
          const parts = email.split('@');
          addrName = parts[0];
          addrDomain = parts[1];
        } else {
          addrName = name || '';
          addrDomain = domain_id
            ? resolveDomain(domain_id)
            : domain
              ? resolveDomain(domain)
              : '';
        }

        if (!addrDomain) {
          if (config.defaultDomain) {
            addrDomain = config.defaultDomain;
          } else {
            const settings = await adapter.getOpenSettings();
            addrDomain = settings.domains?.[0] ?? settings.defaultDomains?.[0] ?? '';
          }
        }

        if (!addrDomain) {
          res.status(400).json(wrapError('Domain is required. Set DEFAULT_DOMAIN or provide domain/domain_id.'));
          return;
        }

        const result = await adapter.createAddress(addrName, addrDomain);
        const localJwt = signLocalJwt(result.address, result.jwt);
        const mailbox = cfAddressToShiroMailbox(result.address, result.address_id);

        res.json(wrapResponse({
          token: localJwt,
          cf_jwt: result.jwt,
          user: {
            id: String(result.address_id ?? result.address),
            email: result.address,
            created_at: new Date().toISOString(),
          },
          mailbox,
        }));
      } catch (err) {
        next(err);
      }
    });

    router.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, address, password } = req.body;
        const loginAddress = email || address;

        if (!loginAddress) {
          res.status(400).json(wrapError('Email/address is required'));
          return;
        }

        const result = await adapter.loginAddress(loginAddress, password || '');
        const localJwt = signLocalJwt(loginAddress, result.jwt);

        res.json(wrapResponse({
          token: localJwt,
          cf_jwt: result.jwt,
          user: {
            id: loginAddress,
            email: loginAddress,
            created_at: new Date().toISOString(),
          },
        }));
      } catch (err) {
        next(err);
      }
    });

    router.post('/mailboxes', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, domain, domain_id } = req.body;

        let resolvedDomain = domain_id
          ? resolveDomain(domain_id)
          : domain
            ? resolveDomain(domain)
            : '';

        if (!resolvedDomain) {
          if (config.defaultDomain) {
            resolvedDomain = config.defaultDomain;
          } else {
            const settings = await adapter.getOpenSettings();
            resolvedDomain = settings.domains?.[0] ?? settings.defaultDomains?.[0] ?? '';
          }
        }

        if (!resolvedDomain) {
          res.status(400).json(wrapError('No domain available. Set DEFAULT_DOMAIN or DOMAIN_MAP in .env'));
          return;
        }

        const result = await adapter.createAddress(name || '', resolvedDomain);
        const localJwt = signLocalJwt(result.address, result.jwt);
        const mailbox = cfAddressToShiroMailbox(result.address, result.address_id);

        res.json(wrapResponse({
          id: mailbox.id,
          address: mailbox.address,
          domain: mailbox.domain,
          local_part: mailbox.local_part,
          created_at: mailbox.created_at,
          expires_at: mailbox.expires_at,
          status: mailbox.status,
          token: localJwt,
          cf_jwt: result.jwt,
        }));
      } catch (err) {
        next(err);
      }
    });

    router.get('/mailboxes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const settings = await adapter.getAddressSettings(req.cfJwt!);
        const mailbox = cfAddressToShiroMailbox(settings.address);

        res.json(wrapResponse({
          mailboxes: [mailbox],
          total: 1,
        }));
      } catch (err) {
        next(err);
      }
    });

    router.get('/mailboxes/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const settings = await adapter.getAddressSettings(req.cfJwt!);
        const mailbox = cfAddressToShiroMailbox(settings.address);

        res.json(wrapResponse(mailbox));
      } catch (err) {
        next(err);
      }
    });

    const deleteCurrentAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const result = await adapter.deleteAddress(req.cfJwt!);
        res.json(wrapResponse({ success: result.success }));
      } catch (err) {
        next(err);
      }
    };

    router.delete('/mailboxes/:id', requireAuth, deleteCurrentAddress);
    router.post('/mailboxes/:id/release', requireAuth, deleteCurrentAddress);

    const extendMailbox = (_req: Request, res: Response): void => {
      res.json(wrapResponse({
        message: 'Mailbox extended (no-op: cloudflare_temp_email does not expire mailboxes)',
      }));
    };

    router.post('/mailboxes/:id/extend', requireAuth, extendMailbox);
    router.patch('/mailboxes/:id/extend', requireAuth, extendMailbox);

    const getParsedMessage = async (
      req: Request,
      res: Response,
      next: NextFunction,
      mailboxId?: string
    ): Promise<void> => {
      try {
        const mail = await adapter.getParsedMail(req.cfJwt!, req.params.id);

        if (!mail) {
          res.status(404).json(wrapError('Message not found'));
          return;
        }

        res.json(wrapResponse(cfParsedMailToShiroMessage(mail, mailboxId)));
      } catch (err) {
        next(err);
      }
    };

    const getRawMessage = async (
      req: Request,
      res: Response,
      next: NextFunction,
      mailboxId?: string
    ): Promise<void> => {
      try {
        const mail = await adapter.getMail(req.cfJwt!, req.params.id);

        if (!mail) {
          res.status(404).json(wrapError('Message not found'));
          return;
        }

        res.json(wrapResponse(cfRawMailToShiroMessage(mail, mailboxId)));
      } catch (err) {
        next(err);
      }
    };

    router.get(
      '/mailboxes/:mailboxId/messages',
      requireAuth,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const page = Math.max(1, parseInt(req.query.page as string) || 1);
          const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size as string) || 20));
          const offset = (page - 1) * pageSize;

          const result = await adapter.listParsedMails(req.cfJwt!, pageSize, offset);

          const messages = result.results.map(mail =>
            cfParsedMailToShiroMessage(mail, req.params.mailboxId)
          );

          res.json(wrapPaginated(messages, result.count, page, pageSize));
        } catch (err) {
          next(err);
        }
      }
    );

    router.delete(
      '/mailboxes/:mailboxId/messages',
      requireAuth,
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          const result = await adapter.clearInbox(req.cfJwt!);
          res.json(wrapResponse({ success: result.success }));
        } catch (err) {
          next(err);
        }
      }
    );

    router.get(
      '/mailboxes/:mailboxId/messages/:id',
      requireAuth,
      async (req: Request, res: Response, next: NextFunction) => {
        await getParsedMessage(req, res, next, req.params.mailboxId);
      }
    );

    router.get(
      '/mailboxes/:mailboxId/messages/:id/raw',
      requireAuth,
      async (req: Request, res: Response, next: NextFunction) => {
        await getRawMessage(req, res, next, req.params.mailboxId);
      }
    );

    router.get('/messages/:id', requireAuth, getParsedMessage);
    router.get('/messages/:id/raw', requireAuth, getRawMessage);

    router.delete('/messages/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await adapter.deleteMail(req.cfJwt!, req.params.id);
        res.json(wrapResponse({ success: result.success }));
      } catch (err) {
        next(err);
      }
    });

    const loadShiroSettings = async () => {
      const cfSettings = await adapter.getOpenSettings();
      return cfSettingsToShiroSettings(cfSettings);
    };

    router.get('/public/settings', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const shiroSettings = await loadShiroSettings();
        res.json(wrapResponse(shiroSettings));
      } catch (err) {
        next(err);
      }
    });

    router.get('/public/domains', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const shiroSettings = await loadShiroSettings();
        res.json(wrapResponse(shiroSettings.domains));
      } catch (err) {
        next(err);
      }
    });

    router.get('/public/site/stats', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const shiroSettings = await loadShiroSettings();
        res.json(wrapResponse({
          activeMailboxCount: 0,
          todayMessageCount: 0,
          activeDomainCount: shiroSettings.domains.length,
          totalUserCount: 0,
          failedJobCount: 0,
          updatedAt: new Date().toISOString(),
        }));
      } catch (err) {
        next(err);
      }
    });
  }
}
