import { config, type MailBackend } from '../config.js';
import type { BackendAdapter } from './base.js';
import { CloudMailAdapter } from './cloudmail.js';
import { CloudflareAdapter } from './cloudflare.js';
import { InbucketAdapter } from './inbucket.js';
import { ICloudHideMyEmailAdapter } from './icloudhidemyemail.js';
import { Mail2925Adapter } from './2925.js';
import { MailpitAdapter } from './mailpit.js';
import { MoemailAdapter } from './moemail.js';
import { OutlookEmailPlusAdapter } from './outlookemailplus.js';
import { ShiroMailAdapter } from './shiromail.js';

export function createBackendAdapter(): BackendAdapter {
  return createBackendAdapterFor(config.mailBackend);
}

export function createBackendAdapterFor(backend: MailBackend): BackendAdapter {
  switch (backend) {
    case 'cloudflare_temp_email':
      return new CloudflareAdapter();
    case 'cloudmail':
      return new CloudMailAdapter();
    case 'shiromail':
      return new ShiroMailAdapter();
    case 'inbucket':
      return new InbucketAdapter();
    case 'icloud_hide_my_email':
      return new ICloudHideMyEmailAdapter();
    case 'mailpit':
      return new MailpitAdapter();
    case 'moemail':
      return new MoemailAdapter();
    case 'outlookemailplus':
      return new OutlookEmailPlusAdapter();
    case '2925':
      return new Mail2925Adapter();
    default: {
      const exhaustive: never = backend;
      throw new Error(`Unsupported mail backend: ${exhaustive}`);
    }
  }
}
