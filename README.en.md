[中文](./README.md) | English

# everyMail

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-everymail-blue?logo=docker)](https://ghcr.io/wangchudi/everymail)
[![Node](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org)

Temporary email API compatibility layer — connect any frontend client to any backend email service.

```mermaid
graph LR
    subgraph Frontend Clients
        A[ShiroMail]
        B[Mailpit]
        C[Inbucket]
        D[CF Client]
        E[moemail]
        F[CloudMail]
        O[OutlookEmailPlus]
    end

    subgraph everyMail
        G[Translation Layer]
    end

    subgraph Backend Services
        H[cloudflare_temp_email]
        I[CloudMail]
        J[ShiroMail]
        K[Inbucket]
        L[Mailpit]
        M[moemail]
        N[OutlookEmailPlus]
        P[iCloud Hide My Email]
        Q[2925]
        R[SMTP/IMAP]
    end

    A & B & C & D & E & F & O -->|Native API| G
    G -->|Adapter| H & I & J & K & L & M & N & P & Q & R
```

## Table of Contents

- [Features](#features)
- [Compatibility Matrix](#compatibility-matrix)
- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [Environment Variables](#environment-variables)
- [API Routes](#api-routes)
- [Backend Mapping Notes](#backend-mapping-notes)
- [Architecture](#architecture)
- [Acknowledgments](#-acknowledgments)

## Features

- **N×M Matrix** — 7 frontend formats × 10 backends, any combination
- **Zero-modification access** — Frontend clients connect directly without changes
- **One-switch backend migration** — Change `MAIL_BACKEND` to switch
- **Docker one-liner** — Pre-built multi-arch images (amd64/arm64)
- **Extensible** — Implement one interface to add a new frontend or backend

## Compatibility Matrix

### Backends (`MAIL_BACKEND`)

| Value | Project | Notes |
|---|---|---|
| `cloudflare_temp_email` | [cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email) | Default, temporary email model |
| `cloudmail` | [cloud-mail](https://github.com/maillab/cloud-mail) | Full account/mailbox system |
| `shiromail` | [ShiroMail](https://github.com/GALIAIS/ShiroMail) | Reverse proxy mode |
| `inbucket` | [Inbucket](https://github.com/inbucket/inbucket) | SMTP testing tool, no auth required |
| `mailpit` | [Mailpit](https://github.com/axllent/mailpit) | Global inbox mode |
| `moemail` | [moemail](https://github.com/beilunyang/moemail) | Cloudflare Pages + D1 |
| `outlookemailplus` | [OutlookEmailPlus](https://github.com/ZeroPointSix/outlookEmailPlus) | Controlled External API + mail pool |
| `icloud_hide_my_email` | [Hide My Email Generator](https://github.com/rtunazzz/hidemyemail-generator) | iCloud forwarding aliases, creation/settings only |
| `2925` | 2925.com | Shared inbox model using Cookie-based API token retrieval |
| `smtp_imap` | Standard SMTP/IMAP service | Read/delete mail over IMAP and expose SMTP/IMAP connection settings |

### Frontend Formats (`ENABLED_FRONTENDS`)

| Value | Route Prefix | Notes |
|---|---|---|
| `shiromail` | `/shiromail` | Native ShiroMail API |
| `cloudflare` | `/cftempmail` | Native cloudflare_temp_email API |
| `inbucket` | `/inbucket` | Inbucket REST API v1 |
| `mailpit` | `/mailpit` | Mailpit REST API v1 |
| `moemail` | `/moemail` | moemail REST API |
| `cloudmail` | `/cloudmail` | CloudMail REST API |
| `outlookemailplus` | `/outlookemailplus` | OutlookEmailPlus External API |

> Any frontend × any backend can be combined. Example: Mailpit UI → moemail backend.

## Quick Start

```bash
git clone https://github.com/WangChuDi/everyMail.git
cd everyMail
npm install
cp .env.example .env   # Edit .env with your backend config
npm run dev            # Development mode (hot reload)
```

Production mode:

```bash
npm run build && npm start
```

Server listens on `http://localhost:3100`.

## Docker Deployment

```bash
docker run -d \
  --name everymail \
  -p 3100:3100 \
  --env-file .env \
  ghcr.io/wangchudi/everymail:latest
```

docker-compose:

```yaml
services:
  everymail:
    image: ghcr.io/wangchudi/everymail:latest
    ports:
      - "3100:3100"
    env_file: .env
    restart: unless-stopped
```

Build locally:

```bash
docker build -t everymail .
docker run -d --name everymail -p 3100:3100 --env-file .env everymail
```

## Environment Variables

### Common

| Variable | Required | Default | Notes |
|---|---|---|---|
| `HOST` | No | `0.0.0.0` | Listen address |
| `PORT` | No | `3100` | Listen port |
| `MAIL_BACKEND` | Yes | — | Backend type (see matrix) |
| `ENABLED_FRONTENDS` | No | `shiromail,cloudflare` | Comma-separated or `all` |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `LOG_LEVEL` | No | `info` | Log level: debug / info / warn / error |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |

### ShiroMail Frontend Format Config

Configuration used when clients connect to the `/shiromail` route:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SHIROMAIL_API_KEY` | No | — | Client auth API Key, empty = public mode |
| `DOMAIN_MAP` | No | `{}` | Domain ID → domain mapping (JSON), e.g. `{"1":"example.com"}` |
| `DEFAULT_DOMAIN` | No | — | Default domain, empty = auto-detect from backend |

### Backend-Specific

<details>
<summary><b>cloudflare_temp_email</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `CF_TEMP_EMAIL_BASE_URL` | Yes | Worker URL |
| `CF_TEMP_EMAIL_AUTH` | No | Corresponds to CF-side PASSWORDS |

</details>

<details>
<summary><b>cloudmail</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `CLOUDMAIL_BASE_URL` | Yes | CloudMail service URL |
| `CLOUDMAIL_AUTH` | Yes | Authorization token (no Bearer prefix) |
| `CLOUDMAIL_FRONTEND_AUTH` | No | Independent auth for CloudMail frontend format, defaults to `CLOUDMAIL_AUTH` |

> Target project: [maillab/cloud-mail](https://github.com/maillab/cloud-mail), API docs: https://doc.skymail.ink/api/api-doc.html

</details>

<details>
<summary><b>shiromail</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `SHIROMAIL_BACKEND_URL` | Yes | ShiroMail backend URL |
| `SHIROMAIL_BACKEND_API_KEY` | Yes | API Key |

</details>

<details>
<summary><b>inbucket</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `INBUCKET_BASE_URL` | Yes | Inbucket URL (default port 9000) |

</details>

<details>
<summary><b>mailpit</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `MAILPIT_BASE_URL` | Yes | Mailpit URL (default port 8025) |
| `MAILPIT_AUTH` | No | HTTP Basic Auth (`user:pass`) |

</details>

<details>
<summary><b>moemail</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `MOEMAIL_BASE_URL` | Yes | moemail service URL |
| `MOEMAIL_AUTH` | Yes | X-API-Key |

</details>

<details>
<summary><b>icloud_hide_my_email</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `ICLOUD_HME_BASE_URL` | No | Apple iCloud Hide My Email private API URL, defaults to `https://p68-maildomainws.icloud.com`; HTTPS is required |
| `ICLOUD_HME_COOKIE` | Yes | Raw `Cookie` header string copied from an authenticated iCloud.com browser session |
| `ICLOUD_HME_CLIENT_ID` | No | Shared query parameter `clientId`, defaults to empty string |
| `ICLOUD_HME_DSID` | No | Shared query parameter `dsid`, defaults to empty string |
| `ICLOUD_HME_DEFAULT_LABEL` | No | Default alias label when create requests do not provide `name`, defaults to `everyMail` |
| `ICLOUD_HME_DEFAULT_NOTE` | No | Optional note sent in reserve requests, defaults to empty string |
| `ICLOUD_HME_REUSE_API_KEY` | No | API key protecting `/icloud-hme/aliases` and `/icloud-hme/reuse`; when empty these helper routes return 403 |
| `ICLOUD_HME_READ_BACKEND` | No | Optional read backend, e.g. `cloudflare_temp_email`; set `icloud_web` to read through iCloud Web Mail; empty keeps message lists empty and message details `null` |
| `ICLOUD_WEB_HOST` | No | iCloud Web host used for `icloud_web` Origin/Referer and default mailws URL; use `icloud.com` or `icloud.com.cn`, default `icloud.com` |
| `ICLOUD_MAIL_BASE_URL` | No | iCloud Mail WebService URL; when empty, `icloud.com` defaults to `https://p44-mailws.icloud.com` and `icloud.com.cn` defaults to `https://p44-mailws.icloud.com.cn` |
| `ICLOUD_MAIL_FOLDER_GUID` | No | Fixed iCloud Mail folder GUID to read; empty auto-detects Inbox |
| `ICLOUD_MAIL_CLIENT_BUILD_NUMBER` | No | iCloud Mail WebService `clientBuildNumber`, default `2206Hotfix11` |
| `ICLOUD_MAIL_CLIENT_MASTERING_NUMBER` | No | iCloud Mail WebService `clientMasteringNumber`, defaults to `ICLOUD_MAIL_CLIENT_BUILD_NUMBER` |

> Reference implementation: [rtunazzz/hidemyemail-generator](https://github.com/rtunazzz/hidemyemail-generator). Authentication is not Apple ID/password login; everyMail reuses the full Cookie request header from an already-authenticated iCloud.com browser session.

> Security note: this Cookie is equivalent to an authenticated iCloud Web session and may grant access beyond Hide My Email. Use a dedicated Apple ID in a controlled environment; export a fresh Cookie when the session expires.

> Limitation: the Hide My Email API itself only manages forwarding aliases and does not expose mailbox retrieval. Without `ICLOUD_HME_READ_BACKEND`, message list methods return empty arrays, single-message lookups return `null`, and delete/clear message operations plus address deletion are compatibility no-ops.

> Read delegation: if your Hide My Email aliases forward into another everyMail-supported receiving backend, set `ICLOUD_HME_READ_BACKEND=cloudflare_temp_email` or another backend value. iCloud HME still owns alias creation/reuse; message lists and message detail calls log in to the read backend with the same address and delegate reads there. Delete message, purge inbox, and delete address remain no-ops to avoid deleting real data from the receiving backend unexpectedly.

> iCloud Web Mail reads: set `ICLOUD_HME_READ_BACKEND=icloud_web` to have everyMail call iCloud Mail WebService `/wm/folder` and `/wm/message` JSON-RPC endpoints with the same iCloud Cookie. This follows FlowPilot's iCloud host handling and browser request-header rules; FlowPilot reads through browser DOM polling, while everyMail uses the server-side WebService shape. For China-region accounts, set `ICLOUD_WEB_HOST=icloud.com.cn`; the default mailws URL becomes `https://p44-mailws.icloud.com.cn` and everyMail sends `https://www.icloud.com.cn` Origin/Referer.

> Reuse: existing login routes such as `/cftempmail/api/address_login` and `/shiromail/auth/login` verify that the address belongs to the configured iCloud session and is active. To let a frontend choose from existing aliases, set `ICLOUD_HME_REUSE_API_KEY` and call `/icloud-hme/aliases`.

</details>

<details>
<summary><b>OutlookEmailPlus</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `OUTLOOKEMAILPLUS_BASE_URL` | Yes | OutlookEmailPlus service URL |
| `OUTLOOKEMAILPLUS_AUTH` | Yes | External API Key (`X-API-Key`) |
| `OUTLOOKEMAILPLUS_PROVIDER` | No | Mail-pool provider, default `outlook` |
| `OUTLOOKEMAILPLUS_CALLER_ID` | No | Mail-pool caller_id, default `everymail` |
| `OUTLOOKEMAILPLUS_PROJECT_KEY` | No | Mail-pool project_key for project isolation/reuse |
| `OUTLOOKEMAILPLUS_FRONTEND_AUTH` | No | Auth key for the OutlookEmailPlus frontend format, defaults to `OUTLOOKEMAILPLUS_AUTH` |

> Target project: [ZeroPointSix/outlookEmailPlus](https://github.com/ZeroPointSix/outlookEmailPlus), using the controlled `/api/external/*` API.

</details>

<details>
<summary><b>SMTP/IMAP</b></summary>

| Variable | Required | Notes |
|---|---|---|
| `SMTP_IMAP_IMAP_HOST` | Yes | IMAP server host |
| `SMTP_IMAP_IMAP_PORT` | No | IMAP port, defaults to `993` |
| `SMTP_IMAP_IMAP_TLS` | No | Whether IMAP uses implicit TLS, defaults to `true` |
| `SMTP_IMAP_SMTP_HOST` | No | SMTP server host exposed through public settings for compatible clients |
| `SMTP_IMAP_SMTP_PORT` | No | SMTP port, defaults to `587` |
| `SMTP_IMAP_SMTP_TLS` | No | Whether SMTP requires STARTTLS/secure transport, defaults to `true` |
| `SMTP_IMAP_USER` | No | Shared IMAP username; empty enables per-address login mode |
| `SMTP_IMAP_PASS` | No | Shared IMAP password |
| `SMTP_IMAP_MAILBOX` | No | IMAP folder to read, defaults to `INBOX` |

Shared-account mode maps one aggregate inbox into everyMail and searches messages by recipient address. Per-address mode lets clients log in with the mailbox address and IMAP password; the password is kept only in server-side process memory, so users must log in again after a service restart.

</details>

## API Routes

Each frontend format exposes the native API of its corresponding project. All requests route to the configured `MAIL_BACKEND`.

<details>
<summary><b>ShiroMail (/shiromail)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/shiromail/auth/register` | POST | Register/create mailbox |
| `/shiromail/auth/login` | POST | Login |
| `/shiromail/mailboxes` | GET | Mailbox list |
| `/shiromail/mailboxes/:id/messages` | GET | Message list |
| `/shiromail/messages/:id` | GET | Message detail |
| `/shiromail/public/settings` | GET | Public settings |

</details>

<details>
<summary><b>Cloudflare (/cftempmail)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/cftempmail/open_api/settings` | GET | Public settings |
| `/cftempmail/api/new_address` | POST | Create address |
| `/cftempmail/api/address_login` | POST | Address login |
| `/cftempmail/api/mails` | GET | Message list |
| `/cftempmail/api/parsed_mails` | GET | Parsed message list |
| `/cftempmail/api/mail/:id` | GET | Raw message |

</details>

<details>
<summary><b>Inbucket (/inbucket)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/inbucket/v1/mailbox/:name` | GET | Mailbox message list |
| `/inbucket/v1/mailbox/:name/:id` | GET | Message detail |
| `/inbucket/v1/mailbox/:name/:id` | DELETE | Delete message |
| `/inbucket/v1/mailbox/:name` | DELETE | Purge mailbox |

</details>

<details>
<summary><b>Mailpit (/mailpit)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/mailpit/v1/messages` | GET | Message list |
| `/mailpit/v1/message/:id` | GET | Message detail |
| `/mailpit/v1/messages` | DELETE | Delete messages |
| `/mailpit/v1/search` | GET | Search messages |

</details>

<details>
<summary><b>moemail (/moemail)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/moemail/api/emails/generate` | POST | Create mailbox |
| `/moemail/api/emails/:emailId` | GET | Message list |
| `/moemail/api/emails/:emailId/:messageId` | GET | Message detail |
| `/moemail/api/emails/:emailId` | DELETE | Delete mailbox |

</details>

<details>
<summary><b>CloudMail (/cloudmail)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/cloudmail/account/add` | POST | Create account |
| `/cloudmail/account/list` | GET | Account list |
| `/cloudmail/email/list` | GET | Message list |
| `/cloudmail/email/delete` | DELETE | Delete message |

</details>

<details>
<summary><b>OutlookEmailPlus (/outlookemailplus)</b></summary>

| Route | Method | Notes |
|---|---|---|
| `/outlookemailplus/api/external/health` | GET | Health check |
| `/outlookemailplus/api/external/pool/claim-random` | POST | Claim/create mailbox |
| `/outlookemailplus/api/external/pool/claim-release` | POST | Release mailbox |
| `/outlookemailplus/api/external/pool/claim-complete` | POST | Mark task complete (compatible no-op) |
| `/outlookemailplus/api/external/messages` | GET | Message list |
| `/outlookemailplus/api/external/messages/:id` | GET | Message detail |
| `/outlookemailplus/api/external/messages/:id/raw` | GET | Raw message detail |

</details>

<details>
<summary><b>iCloud HME Reuse Helper (/icloud-hme)</b></summary>

These routes are mounted only when `MAIL_BACKEND=icloud_hide_my_email`, and require `X-API-Key: <ICLOUD_HME_REUSE_API_KEY>` or `Authorization: Bearer <ICLOUD_HME_REUSE_API_KEY>`.

| Route | Method | Notes |
|---|---|---|
| `/icloud-hme/aliases` | GET | List active Hide My Email aliases that belong to the configured iCloud Cookie session |
| `/icloud-hme/reuse` | POST | Send `{ "address": "..." }`; returns an everyMail JWT after ownership validation |

</details>

## Backend Mapping Notes

Each backend has a different API model. everyMail unifies them through the `BackendAdapter` interface.

<details>
<summary><b>CloudMail Mapping</b></summary>

CloudMail is a full email system; the mapping is not one-to-one:

| everyMail Semantic | CloudMail API | Notes |
|---|---|---|
| Create mailbox | `POST /account/add` | Creates account/address |
| Login | Local JWT wrapper | No CF-style login |
| Settings | Derived from `GET /account/list` | Compatible fields |
| Delete mailbox | `DELETE /account/delete` | Release account |
| Message list | `GET /email/list` | Converted to compatible format |
| Message detail | Lookup in `GET /email/list` | List includes details |
| Delete message | `DELETE /email/delete` | Soft delete |
| Purge inbox | Batch `DELETE /email/delete` | Delete one by one |

</details>

<details>
<summary><b>ShiroMail Mapping</b></summary>

Reverse proxy mode, forwards to real ShiroMail backend:

| everyMail Semantic | ShiroMail API | Notes |
|---|---|---|
| Create mailbox | `POST /api/v1/mailboxes` | Returns mailboxId |
| Login | Lookup via `GET /api/v1/mailboxes` | Find by address |
| Delete mailbox | `POST /api/v1/mailboxes/:id/release` | Release |
| Message list | `GET /api/v1/mailboxes/:id/messages` | — |
| Message detail | `GET /api/v1/mailboxes/:id/messages/:msgId` | — |
| Delete message | Not supported | No such API |

</details>

<details>
<summary><b>Inbucket Mapping</b></summary>

Unauthenticated SMTP testing tool, implicit mailbox creation:

| everyMail Semantic | Inbucket API | Notes |
|---|---|---|
| Create mailbox | Locally composed | No create API |
| Message list | `GET /api/v1/mailbox/{name}` | — |
| Message detail | `GET /api/v1/mailbox/{name}/{id}` | — |
| Delete message | `DELETE /api/v1/mailbox/{name}/{id}` | — |
| Purge mailbox | `DELETE /api/v1/mailbox/{name}` | — |

</details>

<details>
<summary><b>Mailpit Mapping</b></summary>

Global inbox mode, filters by address via search:

| everyMail Semantic | Mailpit API | Notes |
|---|---|---|
| Create mailbox | Locally composed | No mailbox concept |
| Message list | `GET /api/v1/search?query=to:{address}` | Filter by address |
| Message detail | `GET /api/v1/message/{id}` | — |
| Delete message | `DELETE /api/v1/messages` + body | — |
| Purge inbox | `DELETE /api/v1/search?query=to:{address}` | — |

</details>

<details>
<summary><b>moemail Mapping</b></summary>

Cloudflare Pages + D1, X-API-Key auth:

| everyMail Semantic | moemail API | Notes |
|---|---|---|
| Create mailbox | `POST /api/emails/generate` | Returns emailId |
| Message list | `GET /api/emails/{emailId}` | Pagination supported |
| Message detail | `GET /api/emails/{emailId}/{messageId}` | — |
| Delete message | `DELETE /api/emails/{emailId}/{messageId}` | — |
| Delete mailbox | `DELETE /api/emails/{emailId}` | Includes all messages |

</details>

<details>
<summary><b>OutlookEmailPlus Mapping</b></summary>

Uses the controlled External API for mail reading; mailbox creation maps to mail-pool claiming:

| everyMail Semantic | OutlookEmailPlus API | Notes |
|---|---|---|
| Create mailbox | `POST /api/external/pool/claim-random` | Returns email and claim_token |
| Login | Local state wrapper | Read APIs are called by email |
| Message list | `GET /api/external/messages` | Uses `email`, `skip`, `top` |
| Message detail | `GET /api/external/messages/:id` | Uses the `email` query parameter |
| Delete message | Not supported | Returns success for compatibility |
| Delete mailbox | `POST /api/external/pool/claim-release` | Only releases mailboxes claimed by this adapter |

</details>

<details>
<summary><b>iCloud Hide My Email Mapping</b></summary>

Backed by the Apple iCloud web private API for Hide My Email alias management:

| everyMail Semantic | iCloud HME API | Notes |
|---|---|---|
| Create mailbox | `POST /v1/hme/generate` -> `POST /v1/hme/reserve` | Generate alias first, then reserve it with `label`/`note` |
| Login | `GET /v2/hme/list` + local state wrapper | Validates that the existing alias belongs to the configured iCloud Cookie session and is active before issuing a local JWT |
| List reusable mailboxes | `GET /v2/hme/list` | Exposed through `/icloud-hme/aliases`, protected by `ICLOUD_HME_REUSE_API_KEY` |
| Settings | Local JWT payload | Returns the address and compatible fields |
| Delete mailbox | Not supported | No verified safe delete/deactivate endpoint in scope, returns success no-op |
| Message list | Optional `ICLOUD_HME_READ_BACKEND` | Empty value returns an empty list; another backend logs in to the receiving backend with the same address; `icloud_web` reads the iCloud Web Mail inbox |
| Message detail | Optional `ICLOUD_HME_READ_BACKEND` | Empty value returns `null`; another backend delegates reads; `icloud_web` reads through iCloud Mail WebService |
| Delete message / purge inbox | Not supported | Return success no-op |

</details>

<details>
<summary><b>SMTP/IMAP Mapping</b></summary>

Standard SMTP/IMAP services do not expose a common account-creation REST API, so this adapter projects an IMAP inbox into the everyMail backend model:

| everyMail Semantic | SMTP/IMAP Behavior | Notes |
|---|---|---|
| Create mailbox | Compose address and encrypt session locally | Supported only in shared-account mode |
| Login | Verify IMAP login | Shared mode uses configured credentials; per-address mode uses address + password and creates an in-process session |
| Settings | Derived from local session | Returns current address and send balance 0 |
| Message list | IMAP `SEARCH` + `FETCH` | Searches the configured folder by recipient address |
| Message detail | IMAP UID `FETCH` source | Parsed through `mailparser` into compatible fields |
| Delete message | IMAP UID delete | Deletes the matching UID |
| Purge inbox | IMAP search then batch delete | Only deletes messages matching the target address |
| SMTP | Expose connection settings | The current `BackendAdapter` has no send API, so server-side sending is not performed |

</details>

## Architecture

```mermaid
graph TB
    subgraph "FrontendFormat"
        F1[ShiroMailFormat]
        F2[CloudflareFormat]
        F3[InbucketFormat]
        F4[MailpitFormat]
        F5[MoemailFormat]
        F6[CloudMailFormat]
        F7[OutlookEmailPlusFormat]
    end

    subgraph "BackendAdapter"
        B1[CloudflareAdapter]
        B2[CloudMailAdapter]
        B3[ShiroMailAdapter]
        B4[InbucketAdapter]
        B5[MailpitAdapter]
        B6[MoemailAdapter]
        B7[OutlookEmailPlusAdapter]
        B8[ICloudHideMyEmailAdapter]
        B9[Mail2925Adapter]
        B10[SmtpImapAdapter]
    end

    F1 & F2 & F3 & F4 & F5 & F6 & F7 --> Router{Router}
    Router --> B1 & B2 & B3 & B4 & B5 & B6 & B7 & B8 & B9 & B10
```

- **Add a new frontend format**: implement the `FrontendFormat` interface, one file
- **Add a new backend**: implement the `BackendAdapter` interface, one file

<details>
<summary><b>Project Structure</b></summary>

```
src/
├── index.ts              # Entry point, registry loop mounting
├── config.ts             # Configuration management
├── types/                # API type definitions
├── adapters/             # Backend adapters (10)
│   ├── base.ts           # BackendAdapter interface
│   ├── cloudflare.ts
│   ├── cloudmail.ts
│   ├── shiromail.ts
│   ├── inbucket.ts
│   ├── mailpit.ts
│   ├── moemail.ts
│   ├── outlookemailplus.ts
│   ├── icloudhidemyemail.ts
│   ├── 2925.ts
│   └── smtpimap.ts
├── frontend/             # Frontend formats (7)
│   ├── types.ts          # FrontendFormat interface
│   ├── index.ts          # Format registry
│   ├── shiromail.ts
│   ├── cloudflare.ts
│   ├── inbucket.ts
│   ├── mailpit.ts
│   ├── moemail.ts
│   ├── cloudmail.ts
│   └── outlookemailplus.ts
├── middleware/           # Auth, logging, error handling
└── utils/               # JWT, data transformation
```

</details>

<details>
<summary><b>Authentication Flow</b></summary>

```mermaid
sequenceDiagram
    participant Client as ShiroMail Frontend
    participant EM as everyMail
    participant Backend as CF Backend

    Client->>EM: POST /shiromail/auth/register<br/>{name, domain}
    EM->>Backend: POST /api/new_address<br/>{name, domain}
    Backend-->>EM: {jwt, address}
    Note over EM: Issue everyMail JWT (embedded CF JWT)
    EM-->>Client: {token, user, mailbox}

    Client->>EM: GET /shiromail/mailboxes/:id/messages<br/>Authorization: Bearer <everymail-jwt>
    Note over EM: Decode JWT → Extract CF JWT
    EM->>Backend: GET /api/parsed_mails<br/>Authorization: Bearer <cf-jwt>
    Backend-->>EM: {results, count}
    EM-->>Client: {data: messages[]}
```

</details>

## 🙏 Acknowledgments

This project has been published on the [LINUX DO community](https://linux.do). Thanks to the community for their support and feedback.

## License

MIT
