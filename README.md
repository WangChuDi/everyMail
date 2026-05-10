[English](./README.en.md) | 中文
# everyMail

临时邮箱平台兼容层 —— 打通不同临时邮箱服务的 API 适配器。

## 概述

everyMail 是一个本地代理服务器，支持 **N 种前端格式 × M 种后端** 的任意组合：

1. **监听多种邮箱系统的原生 API 格式**（前端格式）
2. **转译为不同开源邮箱系统的后端格式**（后端适配器）
3. **转发到你的邮箱后端实例**

### 支持的后端（MAIL_BACKEND）

| 后端 | 项目 | 说明 |
|------|------|------|
| `cloudflare_temp_email` | [cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email) | 默认，与临时邮箱模型最接近 |
| `cloudmail` | [maillab/cloud-mail](https://github.com/maillab/cloud-mail) | 完整账号/邮箱系统 |
| `shiromail` | [ShiroMail](https://github.com/GALIAIS/ShiroMail) | 反向代理到真实 ShiroMail 后端 |
| `inbucket` | [Inbucket](https://github.com/inbucket/inbucket) | Go SMTP 测试工具，无需认证 |
| `mailpit` | [Mailpit](https://github.com/axllent/mailpit) | 9k+ stars，全局收件箱模式 |
| `moemail` | [moemail](https://github.com/beilunyang/moemail) | Cloudflare Pages + D1 |

### 支持的前端格式（ENABLED_FRONTENDS）

| 前端格式 | 路由前缀 | 说明 |
|----------|---------|------|
| `shiromail` | `/shiromail` | ShiroMail 原生 API 格式 |
| `cloudflare` | `/cftempmail` | cloudflare_temp_email 原生 API |
| `inbucket` | `/inbucket` | Inbucket REST API v1 |
| `mailpit` | `/mailpit` | Mailpit REST API v1 |
| `moemail` | `/moemail` | moemail REST API |
| `cloudmail` | `/cloudmail` | CloudMail REST API |

任意前端格式都可以连接任意后端。例如：用 Mailpit 的前端 UI 连接 moemail 后端。

```
┌─────────────┐                  ┌────────────┐                 ┌────────────────┐
│  任意前端    │  原生 API 格式   │  everyMail │  适配器转换     │  任意后端      │
│  ShiroMail  │ ──────────────► │            │ ───────────────► │ CF/Inbucket/   │
│  Mailpit    │ ◄────────────── │  (翻译层)  │ ◄─────────────── │ Mailpit/...    │
│  Inbucket   │                  │            │                 │                │
└─────────────┘                  └────────────┘                 └────────────────┘

示例：
- ShiroMail 客户端 → http://localhost:3100/shiromail/auth/register
- Mailpit UI → http://localhost:3100/mailpit/v1/messages
- Inbucket UI → http://localhost:3100/inbucket/v1/mailbox/test
- CF 客户端 → http://localhost:3100/cftempmail/api/new_address
```

## 快速开始

### 1. 安装

```bash
git clone <repo-url> everyMail
cd everyMail
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=3100
MAIL_BACKEND=cloudflare_temp_email
CF_TEMP_EMAIL_BASE_URL=https://your-cf-worker.workers.dev
CF_TEMP_EMAIL_AUTH=your-password    # 可选，对应 CF 端 PASSWORDS
JWT_SECRET=your-random-secret

# 启用的前端格式（默认 shiromail,cloudflare）
# 设为 "all" 启用全部 6 种前端格式
ENABLED_FRONTENDS=shiromail,cloudflare
```

启用全部前端格式（任意客户端都能连接）：

```env
ENABLED_FRONTENDS=all
```

如需切换到 CloudMail：

```env
MAIL_BACKEND=cloudmail
CLOUDMAIL_BASE_URL=https://your-cloudmail.example.com
CLOUDMAIL_AUTH=your-cloudmail-token
JWT_SECRET=your-random-secret
```

> CloudMail 目标项目是 [maillab/cloud-mail](https://github.com/maillab/cloud-mail)，官方 API 文档见 https://doc.skymail.ink/api/api-doc.html 。它使用 `Authorization` 原始 token（无 `Bearer ` 前缀），并采用 `{ code, message, data }` 响应包装。

如需切换到 ShiroMail（反向代理模式）：

```env
MAIL_BACKEND=shiromail
SHIROMAIL_BACKEND_URL=https://your-shiromail-backend.example.com
SHIROMAIL_BACKEND_API_KEY=your-api-key
JWT_SECRET=your-random-secret
```

如需切换到 Inbucket（测试环境）：

```env
MAIL_BACKEND=inbucket
INBUCKET_BASE_URL=http://localhost:9000
JWT_SECRET=your-random-secret
```

如需切换到 Mailpit（测试环境）：

```env
MAIL_BACKEND=mailpit
MAILPIT_BASE_URL=http://localhost:8025
MAILPIT_AUTH=user:pass  # 可选，留空则无认证
JWT_SECRET=your-random-secret
```

如需切换到 moemail：

```env
MAIL_BACKEND=moemail
MOEMAIL_BASE_URL=https://moemail.app
MOEMAIL_AUTH=your-api-key
JWT_SECRET=your-random-secret
```

### 3. 运行

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm start
```

服务器启动后会监听在 `http://localhost:3100`。

## 前端格式路由

每种前端格式暴露对应项目的原生 API，所有格式都路由到 `MAIL_BACKEND` 配置的后端。

### ShiroMail 格式（`/shiromail`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/shiromail/auth/register`            | POST     | 注册/创建邮箱  |
| `/shiromail/auth/login`               | POST     | 登录邮箱       |
| `/shiromail/mailboxes`                | GET      | 邮箱列表       |
| `/shiromail/mailboxes/:id/messages`   | GET      | 邮件列表       |
| `/shiromail/messages/:id`             | GET      | 邮件详情       |
| `/shiromail/public/settings`          | GET      | 公开设置       |

### Cloudflare 格式（`/cftempmail`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/cftempmail/open_api/settings`       | GET      | 公开设置       |
| `/cftempmail/api/new_address`         | POST     | 创建地址       |
| `/cftempmail/api/address_login`       | POST     | 地址登录       |
| `/cftempmail/api/mails`               | GET      | 邮件列表       |
| `/cftempmail/api/parsed_mails`        | GET      | 解析邮件列表   |
| `/cftempmail/api/mail/:id`            | GET      | 原始邮件       |

### Inbucket 格式（`/inbucket`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/inbucket/v1/mailbox/:name`          | GET      | 邮箱邮件列表   |
| `/inbucket/v1/mailbox/:name/:id`      | GET      | 邮件详情       |
| `/inbucket/v1/mailbox/:name/:id`      | DELETE   | 删除邮件       |
| `/inbucket/v1/mailbox/:name`          | DELETE   | 清空邮箱       |

### Mailpit 格式（`/mailpit`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/mailpit/v1/messages`                | GET      | 邮件列表       |
| `/mailpit/v1/message/:id`             | GET      | 邮件详情       |
| `/mailpit/v1/messages`                | DELETE   | 删除邮件       |
| `/mailpit/v1/search`                  | GET      | 搜索邮件       |

### moemail 格式（`/moemail`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/moemail/api/emails/generate`        | POST     | 创建邮箱       |
| `/moemail/api/emails/:emailId`        | GET      | 邮件列表       |
| `/moemail/api/emails/:emailId/:messageId` | GET  | 邮件详情       |
| `/moemail/api/emails/:emailId`        | DELETE   | 删除邮箱       |

### CloudMail 格式（`/cloudmail`）

| 路由                                  | 方法     | 说明           |
|---------------------------------------|----------|----------------|
| `/cloudmail/account/add`              | POST     | 创建账号       |
| `/cloudmail/account/list`             | GET      | 账号列表       |
| `/cloudmail/email/list`               | GET      | 邮件列表       |
| `/cloudmail/email/delete`             | DELETE   | 删除邮件       |

## 后端映射说明

所有前端格式都通过 `BackendAdapter` 接口路由到配置的后端。以下是各后端的特殊映射逻辑：

### CloudMail 映射说明

CloudMail 不是一次性临时邮箱模型，而是完整邮箱系统，所以映射关系不是一一同构：

| everyMail 语义 | CloudMail 近似接口 | 说明 |
|----------------|-------------------|------|
| 创建邮箱 | `POST /account/add` | 创建 CloudMail account/address |
| 登录邮箱 | 本地包装 `CLOUDMAIL_AUTH` | CloudMail 没有 CF 风格 `address_login`；everyMail 用本地 JWT 绑定地址 |
| 邮箱设置 | `GET /account/list` 派生 | 返回当前地址与兼容字段 |
| 删除邮箱 | `DELETE /account/delete` | 删除/释放 CloudMail account |
| 邮件列表 | `GET /email/list` | 转换为 CF/ShiroMail 兼容邮件列表 |
| 邮件详情 | `GET /email/list` 内查找 | CloudMail 常见列表响应已包含邮件详情字段 |
| 删除邮件 | `DELETE /email/delete` | CloudMail 软删除邮件 |
| 清空收件箱 | `GET /email/list` + `DELETE /email/delete` | 批量删除当前可见邮件 |

CloudMail 适配器要求服务端配置 `CLOUDMAIL_AUTH`，并把它作为 CloudMail 的 `Authorization` header 发送。

### ShiroMail 后端映射说明

ShiroMail 适配器作为反向代理，将 everyMail 的 BackendAdapter 调用转发到真实的 ShiroMail 后端实例：

| everyMail 语义 | ShiroMail 后端接口 | 说明 |
|----------------|-------------------|------|
| 创建邮箱 | `POST /api/v1/mailboxes` | 创建 ShiroMail 邮箱，返回 mailboxId 作为 JWT 标识 |
| 登录邮箱 | `GET /api/v1/mailboxes` 查找 | 通过地址查找 mailboxId，使用 API Key 认证 |
| 邮箱设置 | 本地合成 | 返回地址信息 |
| 删除邮箱 | `POST /api/v1/mailboxes/:id/release` | 释放邮箱 |
| 邮件列表 | `GET /api/v1/mailboxes/:id/messages` | 获取邮箱消息列表 |
| 邮件详情 | `GET /api/v1/mailboxes/:id/messages/:msgId` | 获取单封邮件 |
| 删除邮件 | 无对应接口 | ShiroMail 不支持单独删除消息 |
| 清空收件箱 | 无对应接口 | 通过释放邮箱实现 |

ShiroMail 适配器使用 `Authorization: Bearer <SHIROMAIL_BACKEND_API_KEY>` 认证。

### Inbucket 映射说明

Inbucket 是无认证的 SMTP 测试工具，邮箱隐式创建（收到邮件时自动创建）：

| everyMail 语义 | Inbucket 接口 | 说明 |
|----------------|--------------|------|
| 创建邮箱 | 本地合成 | Inbucket 无创建接口，返回合成响应 |
| 登录邮箱 | 本地合成 | 地址即为邮箱标识符 |
| 邮箱设置 | 本地合成 | 返回地址信息 |
| 删除邮箱 | `DELETE /api/v1/mailbox/{name}` | 清空邮箱（purge） |
| 邮件列表 | `GET /api/v1/mailbox/{name}` | 获取邮箱消息列表 |
| 邮件详情 | `GET /api/v1/mailbox/{name}/{id}` | 获取单封邮件 |
| 删除邮件 | `DELETE /api/v1/mailbox/{name}/{id}` | 删除单封邮件 |
| 清空收件箱 | `DELETE /api/v1/mailbox/{name}` | 清空邮箱 |

Inbucket 无需认证，适合本地测试环境。

### Mailpit 映射说明

Mailpit 使用全局收件箱模式，通过搜索过滤不同地址的邮件：

| everyMail 语义 | Mailpit 接口 | 说明 |
|----------------|-------------|------|
| 创建邮箱 | 本地合成 | Mailpit 无邮箱概念，返回合成响应 |
| 登录邮箱 | 本地合成 | 地址用于后续搜索过滤 |
| 邮箱设置 | 本地合成 | 返回地址信息 |
| 删除邮箱 | `DELETE /api/v1/search?query=to:{address}` | 删除该地址的所有邮件 |
| 邮件列表 | `GET /api/v1/search?query=to:{address}` | 搜索该地址的邮件 |
| 邮件详情 | `GET /api/v1/message/{id}` | 获取单封邮件 |
| 删除邮件 | `DELETE /api/v1/messages` + body | 删除指定邮件 |
| 清空收件箱 | `DELETE /api/v1/search?query=to:{address}` | 删除该地址的所有邮件 |

Mailpit 支持可选的 HTTP Basic Auth（`MAILPIT_AUTH=user:pass`）。

### moemail 映射说明

moemail 基于 Cloudflare Pages + D1，使用 X-API-Key 认证：

| everyMail 语义 | moemail 接口 | 说明 |
|----------------|-------------|------|
| 创建邮箱 | `POST /api/emails/generate` | 创建邮箱，返回 emailId 和 address |
| 登录邮箱 | `GET /api/emails` 查找 | 通过地址查找 emailId |
| 邮箱设置 | 本地合成 | 返回地址信息 |
| 删除邮箱 | `DELETE /api/emails/{emailId}` | 删除邮箱及其所有邮件 |
| 邮件列表 | `GET /api/emails/{emailId}` | 获取邮箱消息列表（支持分页） |
| 邮件详情 | `GET /api/emails/{emailId}/{messageId}` | 获取单封邮件 |
| 删除邮件 | `DELETE /api/emails/{emailId}/{messageId}` | 删除单封邮件 |
| 清空收件箱 | `DELETE /api/emails/{emailId}` | 删除邮箱（等价于清空） |

moemail 使用 `X-API-Key: <MOEMAIL_AUTH>` 认证。

## 架构设计

### 双层适配器模式

everyMail 使用 **前端格式 × 后端适配器** 的矩阵架构：

```
FrontendFormat (前端接口)          BackendAdapter (后端接口)
    ├── ShiroMailFormat                ├── CloudflareAdapter
    ├── CloudflareFormat               ├── CloudMailAdapter
    ├── InbucketFormat                 ├── ShiroMailAdapter
    ├── MailpitFormat                  ├── InbucketAdapter
    ├── MoemailFormat                  ├── MailpitAdapter
    └── CloudMailFormat                └── MoemailAdapter
```

- **添加新前端格式**：实现 `FrontendFormat` 接口，一个文件搞定
- **添加新后端**：实现 `BackendAdapter` 接口，一个文件搞定

### 项目结构

```
src/
├── index.ts              # 入口 - 注册表循环挂载
├── config.ts             # 配置管理（MAIL_BACKEND + ENABLED_FRONTENDS）
├── types/
│   ├── shiromail.ts      # ShiroMail API 类型
│   ├── cloudflare.ts     # CF API 类型
│   └── cloudmail.ts      # CloudMail API 类型
├── adapters/             # 后端适配器（6 个）
│   ├── base.ts           # BackendAdapter 接口
│   ├── cloudflare.ts
│   ├── cloudmail.ts
│   ├── shiromail.ts
│   ├── inbucket.ts
│   ├── mailpit.ts
│   └── moemail.ts
├── frontend/             # 前端格式（6 个）
│   ├── types.ts          # FrontendFormat 接口
│   ├── index.ts          # 格式注册表
│   ├── shiromail.ts      # ShiroMail API 路由
│   ├── cloudflare.ts     # CF API 路由
│   ├── inbucket.ts       # Inbucket API 路由
│   ├── mailpit.ts        # Mailpit API 路由
│   ├── moemail.ts        # moemail API 路由
│   └── cloudmail.ts      # CloudMail API 路由
├── middleware/
│   ├── auth.ts           # 共享认证工具
│   ├── logger.ts         # 请求日志
│   └── errorHandler.ts   # 错误处理
└── utils/
    ├── transformer.ts    # 数据格式转换
    └── jwt.ts            # JWT 工具
```

## 认证流程

```
ShiroMail 前端                     everyMail                     CF 后端
     │                                │                              │
     ├─ POST /shiromail/auth/register ►│                              │
     │   { name, domain }             ├─ POST /api/new_address ─────►│
     │                                │   { name, domain }           │
     │                                │◄──── { jwt, address } ──────┤
     │                                │                              │
     │                                │  签发 everyMail JWT          │
     │                                │  (内嵌 CF JWT)               │
     │◄── { token, user, mailbox } ──┤                              │
     │                                │                              │
     ├─ GET /shiromail/mailboxes/:id/messages ─►│                    │
     │   Authorization: Bearer <everymail-jwt>                       │
     │                                │  解码 everyMail JWT          │
     │                                │  提取 CF JWT                 │
     │                                ├─ GET /api/parsed_mails ─────►│
     │                                │   Authorization: Bearer <cf-jwt>
     │                                │◄──── { results, count } ────┤
     │◄── { data: messages[] } ──────┤                              │
```

## License

MIT
