import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { config, getMappedDomains, type MailBackend } from './config.js';
import { createBackendAdapter } from './adapters/index.js';
import { ICloudHideMyEmailAdapter } from './adapters/icloudhidemyemail.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { resolveFormats } from './frontend/index.js';

const app = express();

app.use(express.json());
app.use(requestLogger);

app.use((_req, res, next) => {
  const allowedOrigin = config.corsOrigin || '*';
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, x-api-key, x-custom-auth, x-user-token');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

const adapter = createBackendAdapter();
const formats = resolveFormats(config.enabledFrontends);

// Startup compatibility check: warn about auth-free frontends × auth-required backends
const AUTH_FREE_FRONTENDS = ['inbucket', 'mailpit'];
const AUTH_REQUIRED_BACKENDS: MailBackend[] = ['cloudflare_temp_email'];
const enabledAuthFreeFrontends = formats
  .filter(f => AUTH_FREE_FRONTENDS.includes(f.name))
  .map(f => f.name);

if (enabledAuthFreeFrontends.length > 0 && AUTH_REQUIRED_BACKENDS.includes(config.mailBackend)) {
  console.warn('');
  console.warn('⚠ Compatibility warning:');
  for (const name of enabledAuthFreeFrontends) {
    console.warn(`  ${name} frontend + ${config.mailBackend} backend:`);
    console.warn(`    ${name} protocol has no per-user auth. loginAddress(address, '') may fail`);
    console.warn(`    for backends requiring real credentials. Consider using a matching backend.`);
  }
  console.warn('');
}

for (const format of formats) {
  const subRouter = Router();
  const authMw = format.createAuthMiddleware();
  if (authMw) {
    subRouter.use(authMw);
  }
  format.registerRoutes(subRouter, adapter);
  app.use(format.routePrefix, subRouter);
}

if (adapter instanceof ICloudHideMyEmailAdapter) {
  const icloudRouter = Router();
  icloudRouter.use(requireICloudHmeReuseApiKey);

  icloudRouter.get('/aliases', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const aliases = await adapter.listReusableAliases();
      res.json({ aliases, count: aliases.length });
    } catch (err) {
      next(err);
    }
  });

  icloudRouter.post('/reuse', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = typeof req.body.address === 'string' ? req.body.address : '';
      const reused = await adapter.reuseAddress(address);
      res.json(reused);
    } catch (err) {
      next(err);
    }
  });

  app.use('/icloud-hme', icloudRouter);
}

app.get('/health', (_req, res) => {
  const domains = getMappedDomains();
  res.json({
    status: 'ok',
    adapter: adapter.name,
    backend: config.mailBackend,
    enabledFrontends: config.enabledFrontends,
    apiKeyRequired: !!config.shiroApiKey,
    domainMap: domains.length > 0 ? domains : 'auto (from backend)',
    defaultDomain: config.defaultDomain || 'auto (from backend)',
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);

function requireICloudHmeReuseApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.icloudHmeReuseApiKey) {
    res.status(403).json({ error: 'ICLOUD_HME_REUSE_API_KEY is required to enable iCloud HME alias reuse routes' });
    return;
  }

  const bearer = req.header('authorization')?.startsWith('Bearer ')
    ? req.header('authorization')?.slice(7)
    : undefined;
  const apiKey = req.header('X-API-Key') ?? bearer ?? '';

  if (apiKey !== config.icloudHmeReuseApiKey) {
    res.status(401).json({ error: 'Invalid iCloud HME reuse API key' });
    return;
  }

  next();
}

const domainEntries = getMappedDomains();
const domainStatus = domainEntries.length > 0
  ? `${domainEntries.length} 个映射`
  : '自动 (从后端获取)';

app.listen(config.port, config.host, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║              everyMail 兼容层启动                ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  监听地址:    ${`${config.host}:${config.port}`.padEnd(35)}║`);
  console.log(`║  后端适配器:  ${adapter.name.padEnd(35)}║`);
  console.log(`║  后端类型:    ${config.mailBackend.padEnd(35)}║`);
  console.log(`║  域名映射:    ${domainStatus.padEnd(35)}║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log('║  启用的前端格式:                                  ║');
  for (const f of formats) {
    const line = `    ${f.name} → ${f.routePrefix}`;
    console.log(`║  ${line.padEnd(47)}║`);
  }
  console.log('║  健康检查:       /health                         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

export default app;
