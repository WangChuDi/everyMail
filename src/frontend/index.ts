import type { FrontendFormat } from './types.js';
import { ShiroMailFormat } from './shiromail.js';
import { CloudflareFormat } from './cloudflare.js';
import { InbucketFormat } from './inbucket.js';
import { MailpitFormat } from './mailpit.js';
import { MoemailFormat } from './moemail.js';
import { CloudMailFormat } from './cloudmail.js';

const ALL_FORMATS: FrontendFormat[] = [
  new ShiroMailFormat(),
  new CloudflareFormat(),
  new InbucketFormat(),
  new MailpitFormat(),
  new MoemailFormat(),
  new CloudMailFormat(),
];

export function resolveFormats(enabledNames: string[]): FrontendFormat[] {
  const byName = new Map(ALL_FORMATS.map(f => [f.name, f]));
  const resolved = enabledNames
    .map(n => byName.get(n))
    .filter((f): f is FrontendFormat => f !== undefined);

  const prefixes = new Set<string>();
  for (const f of resolved) {
    if (prefixes.has(f.routePrefix)) {
      throw new Error(`Duplicate route prefix "${f.routePrefix}" from format "${f.name}"`);
    }
    prefixes.add(f.routePrefix);
  }

  return resolved;
}
