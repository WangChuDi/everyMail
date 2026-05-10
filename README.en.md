[中文](./README.md) | English
# everyMail

Temporary email platform compatibility layer, an API adapter that bridges different temporary email services.

## Overview

everyMail is a local proxy server that supports any combination of **N frontend formats × M backends**:

1. **Listen to native API formats from multiple email systems** (frontend formats)
2. **Translate them into backend formats for different open source email systems** (backend adapters)
3. **Forward requests to your email backend instance**

### Supported Backends (MAIL_BACKEND)

| Backend | Project | Notes |
|------|------|------|
| `cloudflare_temp_email` | [cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email) | Default, closest to the temporary email model |
| `cloudmail` | [maillab/cloud-mail](https://github.com/maillab/cloud-mail) | Full account and mailbox system |
| `shiromail` | [ShiroMail](https://github.com/GALIAIS/ShiroMail) | Reverse proxy to a real ShiroMail backend |
| `inbucket` | [Inbucket](https://github.com/inbucket/inbucket) | Go SMTP testing tool, no authentication required |
| `mailpit` | [Mailpit](https://github.com/axllent/mailpit) | 9k+ stars, global inbox mode |
| `moemail` | [moemail](https://github.com/beilunyang/moemail) | Cloudflare Pages + D1 |

### Supported Frontend Formats (ENABLED_FRONTENDS)

| Frontend Format | Route Prefix | Notes |
|----------|---------|------|
| `shiromail` | `/shiromail` | Native ShiroMail API format |
| `cloudflare` | `/cftempmail` | Native cloudflare_temp_email API |
| `inbucket` | `/inbucket` | Inbucket REST API v1 |
| `mailpit` | `/mailpit` | Mailpit REST API v1 |
| `moemail` | `/moemail` | moemail REST API |
| `cloudmail` | `/cloudmail` | CloudMail REST API |

Any frontend format can connect to any backend. For example, use Mailpit's frontend UI with a moemail backend.

```
┌─────────────┐                  ┌────────────┐                 ┌────────────────┐
│ Any Frontend │  Native API     │  everyMail │  Adapter        │ Any Backend    │
│  ShiroMail  │ ──────────────► │            │  Translation    │ CF/Inbucket/   │
│  Mailpit    │ ◄────────────── │ (Translate)│ ◄─────────────── │ Mailpit/...    │
│  Inbucket   │                  │   Layer    │                 │                │
└─────────────┘                  └────────────┘                 └────────────────┘

Examples:
- ShiroMail client → http://localhost:3100/shiromail/auth/register
- Mailpit UI → http://localhost:3100/mailpit/v1/messages
- Inbucket UI → http://localhost:3100/inbucket/v1/mailbox/test
- CF client → http://localhost:3100/cftempmail/api/new_address
```

## Quick Start

### 1. Install

```bash
git clone <repo-url> everyMail
cd everyMail
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3100
MAIL_BACKEND=cloudflare_temp_email
CF_TEMP_EMAIL_BASE_URL=https://your-cf-worker.workers.dev
CF_TEMP_EMAIL_AUTH=your-password    # Optional, corresponds to CF-side PASSWORDS
JWT_SECRET=your-random-secret

# Enabled frontend formats (default: shiromail,cloudflare)
# Set to "all" to enable all 6 frontend formats
ENABLED_FRONTENDS=shiromail,cloudflare
```

Enable all frontend formats (any client can connect):

```env
ENABLED_FRONTENDS=all
```

To switch to CloudMail:

```env
MAIL_BACKEND=cloudmail
CLOUDMAIL_BASE_URL=https://your-cloudmail.example.com
CLOUDMAIL_AUTH=your-cloudmail-token
JWT_SECRET=your-random-secret
```

> CloudMail target project is [maillab/cloud-mail](https://github.com/maillab/cloud-mail). The official API documentation is at https://doc.skymail.ink/api/api-doc.html . It uses a raw `Authorization` token (without the `Bearer ` prefix), and wraps responses as `{ code, message, data }`.

To switch to ShiroMail (reverse proxy mode):

```env
MAIL_BACKEND=shiromail
SHIROMAIL_BACKEND_URL=https://your-shiromail-backend.example.com
SHIROMAIL_BACKEND_API_KEY=your-api-key
JWT_SECRET=your-random-secret
```

To switch to Inbucket (test environment):

```env
MAIL_BACKEND=inbucket
INBUCKET_BASE_URL=http://localhost:9000
JWT_SECRET=your-random-secret
```

To switch to Mailpit (test environment):

```env
MAIL_BACKEND=mailpit
MAILPIT_BASE_URL=http://localhost:8025
MAILPIT_AUTH=user:pass  # Optional, leave empty for no authentication
JWT_SECRET=your-random-secret
```

To switch to moemail:

```env
MAIL_BACKEND=moemail
MOEMAIL_BASE_URL=https://moemail.app
MOEMAIL_AUTH=your-api-key
JWT_SECRET=your-random-secret
```

### 3. Run

```bash
# Development mode (hot reload)
npm run dev

# Production mode
npm run build
npm start
```

After startup, the server listens on `http://localhost:3100`.

### 4. Docker Deployment

Use the pre-built image from GitHub Container Registry:

```bash
docker run -d \
  --name everymail \
  -p 3100:3100 \
  -e MAIL_BACKEND=cloudflare_temp_email \
  -e CF_TEMP_EMAIL_BASE_URL=https://your-cf-worker.workers.dev \
  -e CF_TEMP_EMAIL_AUTH=your-password \
  -e JWT_SECRET=your-random-secret \
  -e ENABLED_FRONTENDS=all \
  ghcr.io/wangchudi/everymail:latest
```

Or use docker-compose:

```yaml
# docker-compose.yml
services:
  everymail:
    image: ghcr.io/wangchudi/everymail:latest
    ports:
      - "3100:3100"
    environment:
      - MAIL_BACKEND=cloudflare_temp_email
      - CF_TEMP_EMAIL_BASE_URL=https://your-cf-worker.workers.dev
      - CF_TEMP_EMAIL_AUTH=your-password
      - JWT_SECRET=your-random-secret
      - ENABLED_FRONTENDS=all
    restart: unless-stopped
```

Build locally:

```bash
docker build -t everymail .
docker run -d --name everymail -p 3100:3100 --env-file .env everymail
```

## Frontend Format Routes

Each frontend format exposes the native API of its corresponding project, and all formats are routed to the backend configured by `MAIL_BACKEND`.

### ShiroMail Format (`/shiromail`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/shiromail/auth/register`            | POST     | Register and create mailbox |
| `/shiromail/auth/login`               | POST     | Mailbox login  |
| `/shiromail/mailboxes`                | GET      | Mailbox list   |
| `/shiromail/mailboxes/:id/messages`   | GET      | Message list   |
| `/shiromail/messages/:id`             | GET      | Message detail |
| `/shiromail/public/settings`          | GET      | Public settings |

### Cloudflare Format (`/cftempmail`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/cftempmail/open_api/settings`       | GET      | Public settings |
| `/cftempmail/api/new_address`         | POST     | Create address |
| `/cftempmail/api/address_login`       | POST     | Address login  |
| `/cftempmail/api/mails`               | GET      | Message list   |
| `/cftempmail/api/parsed_mails`        | GET      | Parsed message list |
| `/cftempmail/api/mail/:id`            | GET      | Raw message    |

### Inbucket Format (`/inbucket`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/inbucket/v1/mailbox/:name`          | GET      | Mailbox message list |
| `/inbucket/v1/mailbox/:name/:id`      | GET      | Message detail |
| `/inbucket/v1/mailbox/:name/:id`      | DELETE   | Delete message |
| `/inbucket/v1/mailbox/:name`          | DELETE   | Purge mailbox  |

### Mailpit Format (`/mailpit`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/mailpit/v1/messages`                | GET      | Message list   |
| `/mailpit/v1/message/:id`             | GET      | Message detail |
| `/mailpit/v1/messages`                | DELETE   | Delete messages |
| `/mailpit/v1/search`                  | GET      | Search messages |

### moemail Format (`/moemail`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/moemail/api/emails/generate`        | POST     | Create mailbox |
| `/moemail/api/emails/:emailId`        | GET      | Message list   |
| `/moemail/api/emails/:emailId/:messageId` | GET  | Message detail |
| `/moemail/api/emails/:emailId`        | DELETE   | Delete mailbox |

### CloudMail Format (`/cloudmail`)

| Route                                  | Method   | Notes          |
|---------------------------------------|----------|----------------|
| `/cloudmail/account/add`              | POST     | Create account |
| `/cloudmail/account/list`             | GET      | Account list   |
| `/cloudmail/email/list`               | GET      | Message list   |
| `/cloudmail/email/delete`             | DELETE   | Delete message |

## Backend Mapping Notes

All frontend formats route to the configured backend through the `BackendAdapter` interface. Below are the special mapping rules for each backend.

### CloudMail Mapping Notes

CloudMail is not a one-time temporary mailbox model, it is a full email system, so the mapping is not one-to-one isomorphic:

| everyMail Semantic | CloudMail Approximate API | Notes |
|----------------|-------------------|------|
| Create mailbox | `POST /account/add` | Create CloudMail account and address |
| Login mailbox | Local wrapper for `CLOUDMAIL_AUTH` | CloudMail has no CF-style `address_login`, everyMail binds address with local JWT |
| Mailbox settings | Derived from `GET /account/list` | Returns current address and compatible fields |
| Delete mailbox | `DELETE /account/delete` | Delete and release CloudMail account |
| Message list | `GET /email/list` | Converted to CF and ShiroMail compatible message list |
| Message detail | Lookup inside `GET /email/list` | Common CloudMail list responses already include detail fields |
| Delete message | `DELETE /email/delete` | CloudMail soft deletes messages |
| Purge inbox | `GET /email/list` + `DELETE /email/delete` | Batch delete currently visible messages |

The CloudMail adapter requires `CLOUDMAIL_AUTH` to be configured on the server side, and sends it as CloudMail's `Authorization` header.

### ShiroMail Backend Mapping Notes

The ShiroMail adapter acts as a reverse proxy and forwards everyMail `BackendAdapter` calls to a real ShiroMail backend instance:

| everyMail Semantic | ShiroMail Backend API | Notes |
|----------------|-------------------|------|
| Create mailbox | `POST /api/v1/mailboxes` | Create a ShiroMail mailbox, return mailboxId as JWT identity |
| Login mailbox | Lookup via `GET /api/v1/mailboxes` | Find mailboxId by address, authenticated with API Key |
| Mailbox settings | Locally composed | Returns address information |
| Delete mailbox | `POST /api/v1/mailboxes/:id/release` | Release mailbox |
| Message list | `GET /api/v1/mailboxes/:id/messages` | Get mailbox message list |
| Message detail | `GET /api/v1/mailboxes/:id/messages/:msgId` | Get a single message |
| Delete message | No matching API | ShiroMail does not support deleting a single message |
| Purge inbox | No matching API | Achieved by releasing mailbox |

The ShiroMail adapter authenticates with `Authorization: Bearer <SHIROMAIL_BACKEND_API_KEY>`.

### Inbucket Mapping Notes

Inbucket is an unauthenticated SMTP testing tool with implicit mailbox creation, mailboxes are created automatically when mail arrives:

| everyMail Semantic | Inbucket API | Notes |
|----------------|--------------|------|
| Create mailbox | Locally composed | Inbucket has no create API, returns a synthetic response |
| Login mailbox | Locally composed | Address itself is the mailbox identifier |
| Mailbox settings | Locally composed | Returns address information |
| Delete mailbox | `DELETE /api/v1/mailbox/{name}` | Purge mailbox |
| Message list | `GET /api/v1/mailbox/{name}` | Get mailbox message list |
| Message detail | `GET /api/v1/mailbox/{name}/{id}` | Get a single message |
| Delete message | `DELETE /api/v1/mailbox/{name}/{id}` | Delete a single message |
| Purge inbox | `DELETE /api/v1/mailbox/{name}` | Purge mailbox |

Inbucket requires no authentication and is suitable for local testing.

### Mailpit Mapping Notes

Mailpit uses a global inbox model and filters mail for different addresses via search:

| everyMail Semantic | Mailpit API | Notes |
|----------------|-------------|------|
| Create mailbox | Locally composed | Mailpit has no mailbox concept, returns a synthetic response |
| Login mailbox | Locally composed | Address is used for subsequent search filters |
| Mailbox settings | Locally composed | Returns address information |
| Delete mailbox | `DELETE /api/v1/search?query=to:{address}` | Delete all messages for that address |
| Message list | `GET /api/v1/search?query=to:{address}` | Search messages for that address |
| Message detail | `GET /api/v1/message/{id}` | Get a single message |
| Delete message | `DELETE /api/v1/messages` + body | Delete specified messages |
| Purge inbox | `DELETE /api/v1/search?query=to:{address}` | Delete all messages for that address |

Mailpit supports optional HTTP Basic Auth (`MAILPIT_AUTH=user:pass`).

### moemail Mapping Notes

moemail is based on Cloudflare Pages + D1 and uses X-API-Key authentication:

| everyMail Semantic | moemail API | Notes |
|----------------|-------------|------|
| Create mailbox | `POST /api/emails/generate` | Create mailbox and return emailId and address |
| Login mailbox | Lookup via `GET /api/emails` | Find emailId by address |
| Mailbox settings | Locally composed | Returns address information |
| Delete mailbox | `DELETE /api/emails/{emailId}` | Delete mailbox and all its messages |
| Message list | `GET /api/emails/{emailId}` | Get mailbox message list (pagination supported) |
| Message detail | `GET /api/emails/{emailId}/{messageId}` | Get a single message |
| Delete message | `DELETE /api/emails/{emailId}/{messageId}` | Delete a single message |
| Purge inbox | `DELETE /api/emails/{emailId}` | Delete mailbox (equivalent to purge) |

moemail authenticates with `X-API-Key: <MOEMAIL_AUTH>`.

## Architecture

### Two-Layer Adapter Pattern

everyMail uses a matrix architecture of **frontend formats × backend adapters**:

```
FrontendFormat (frontend interface)    BackendAdapter (backend interface)
    ├── ShiroMailFormat                ├── CloudflareAdapter
    ├── CloudflareFormat               ├── CloudMailAdapter
    ├── InbucketFormat                 ├── ShiroMailAdapter
    ├── MailpitFormat                  ├── InbucketAdapter
    ├── MoemailFormat                  ├── MailpitAdapter
    └── CloudMailFormat                └── MoemailAdapter
```

- **Add a new frontend format**: implement the `FrontendFormat` interface, done in one file
- **Add a new backend**: implement the `BackendAdapter` interface, done in one file

### Project Structure

```
src/
├── index.ts              # Entry point, registry loop mounting
├── config.ts             # Configuration management (MAIL_BACKEND + ENABLED_FRONTENDS)
├── types/
│   ├── shiromail.ts      # ShiroMail API types
│   ├── cloudflare.ts     # CF API types
│   └── cloudmail.ts      # CloudMail API types
├── adapters/             # Backend adapters (6)
│   ├── base.ts           # BackendAdapter interface
│   ├── cloudflare.ts
│   ├── cloudmail.ts
│   ├── shiromail.ts
│   ├── inbucket.ts
│   ├── mailpit.ts
│   └── moemail.ts
├── frontend/             # Frontend formats (6)
│   ├── types.ts          # FrontendFormat interface
│   ├── index.ts          # Format registry
│   ├── shiromail.ts      # ShiroMail API routes
│   ├── cloudflare.ts     # CF API routes
│   ├── inbucket.ts       # Inbucket API routes
│   ├── mailpit.ts        # Mailpit API routes
│   ├── moemail.ts        # moemail API routes
│   └── cloudmail.ts      # CloudMail API routes
├── middleware/
│   ├── auth.ts           # Shared authentication utilities
│   ├── logger.ts         # Request logging
│   └── errorHandler.ts   # Error handling
└── utils/
    ├── transformer.ts    # Data format conversion
    └── jwt.ts            # JWT utilities
```

## Authentication Flow

```
ShiroMail Frontend                  everyMail                     CF Backend
     │                                │                              │
     ├─ POST /shiromail/auth/register ►│                              │
     │   { name, domain }             ├─ POST /api/new_address ─────►│
     │                                │   { name, domain }           │
     │                                │◄──── { jwt, address } ──────┤
     │                                │                              │
     │                                │  Issue everyMail JWT         │
     │                                │  (embedded CF JWT)           │
     │◄── { token, user, mailbox } ──┤                              │
     │                                │                              │
     ├─ GET /shiromail/mailboxes/:id/messages ─►│                    │
     │   Authorization: Bearer <everymail-jwt>                       │
     │                                │  Decode everyMail JWT        │
     │                                │  Extract CF JWT              │
     │                                ├─ GET /api/parsed_mails ─────►│
     │                                │   Authorization: Bearer <cf-jwt>
     │                                │◄──── { results, count } ────┤
     │◄── { data: messages[] } ──────┤                              │
```

## 🙏 Acknowledgments

This project has been published on the [LINUX DO community](https://linux.do). Thanks to the community for their support and feedback.

## License

MIT
<!-- OMO_INTERNAL_INITIATOR -->
