import { Router, Request, Response, NextFunction } from 'express';
import { FrontendFormat } from './types.js';
import { BackendAdapter } from '../adapters/base.js';
import { signLocalJwt } from '../utils/jwt.js';

export class CloudflareFormat implements FrontendFormat {
  readonly name = 'cloudflare';
  readonly routePrefix = '/cftempmail';

  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null {
    return (req: Request, _res: Response, next: NextFunction): void => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        req.cfJwt = auth.slice(7);
      }
      next();
    };
  }

  registerRoutes(router: Router, adapter: BackendAdapter): void {
    router.get('/open_api/settings', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const settings = await adapter.getOpenSettings();
        res.json(settings);
      } catch (err) {
        next(err);
      }
    });

    router.post('/api/new_address', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, domain } = req.body;
        const result = await adapter.createAddress(name || '', domain || '');
        const localJwt = signLocalJwt(result.address, result.jwt);

        res.json({
          ...result,
          everymail_jwt: localJwt,
        });
      } catch (err) {
        next(err);
      }
    });

    router.post('/api/address_login', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { address, password } = req.body;
        const result = await adapter.loginAddress(address, password || '');
        const localJwt = signLocalJwt(address, result.jwt);

        res.json({
          ...result,
          everymail_jwt: localJwt,
        });
      } catch (err) {
        next(err);
      }
    });

    router.get('/api/mails', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await adapter.listMails(jwt, limit, offset);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/api/parsed_mails', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await adapter.listParsedMails(jwt, limit, offset);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/api/mail/:mail_id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.getMail(jwt, req.params.mail_id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/api/parsed_mail/:mail_id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.getParsedMail(jwt, req.params.mail_id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.delete('/api/mails/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.deleteMail(jwt, req.params.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/api/settings', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.getAddressSettings(jwt);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.delete('/api/delete_address', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.deleteAddress(jwt);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.delete('/api/clear_inbox', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const jwt = req.cfJwt;
        if (!jwt) {
          res.status(401).json({ error: 'JWT required' });
          return;
        }

        const result = await adapter.clearInbox(jwt);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/health_check', async (_req: Request, res: Response) => {
      res.send('OK');
    });
  }
}
