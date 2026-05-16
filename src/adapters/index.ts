import { config } from '../config.js';
import type { BackendAdapter } from './base.js';
import { CloudMailAdapter } from './cloudmail.js';
import { CloudflareAdapter } from './cloudflare.js';
import { InbucketAdapter } from './inbucket.js';
import { MailpitAdapter } from './mailpit.js';
import { MoemailAdapter } from './moemail.js';
import { OutlookEmailPlusAdapter } from './outlookemailplus.js';
import { ShiroMailAdapter } from './shiromail.js';

export function createBackendAdapter(): BackendAdapter {
  switch (config.mailBackend) {
    case 'cloudflare_temp_email':
      return new CloudflareAdapter();
    case 'cloudmail':
      return new CloudMailAdapter();
    case 'shiromail':
      return new ShiroMailAdapter();
    case 'inbucket':
      return new InbucketAdapter();
    case 'mailpit':
      return new MailpitAdapter();
    case 'moemail':
      return new MoemailAdapter();
    case 'outlookemailplus':
      return new OutlookEmailPlusAdapter();
    default: {
      const exhaustive: never = config.mailBackend;
      throw new Error(`Unsupported mail backend: ${exhaustive}`);
    }
  }
}
