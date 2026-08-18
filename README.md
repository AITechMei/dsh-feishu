# feishu/ — Feishu/Lark messaging bot channel

English | [中文](README.zh.md)

`@aitechmei/dsh-feishu` connects the harness to a Feishu (or international Lark) app as a messaging bot. One plugin row subscribes to inbound messages through the official `@larksuiteoapi/node-sdk` WebSocket long connection (no public URL required), binds each chat to a durable harness session, and relays the agent's assistant replies back to the chat as plain-text messages.

The flow mirrors how a server like the ACP bridge drives an agent: inbound text is admitted to a per-chat `Agent` via `agent.followup()`, and committed `assistant/message` session events are delivered back out. The channel model is the OpenClaw Feishu channel, scoped to messaging (bot DMs and group chats, with @mention gating) and not to Feishu document/wiki/drive tools.

## Installation

Install as a plugin bundle into a dsh profile. The profile directory is a
pnpm workspace root, so `pnpm add` needs the `-w` flag:

```sh
dsh plugin --profile feishu add -w @aitechmei/dsh-feishu
```

From a plugin checkout, mount the local path instead of the registry name:

```sh
dsh plugin --profile feishu add -w file:/path/to/dsh-feishu
```

The plugin's `dsh.bundle` patch inserts the `feishu` row after `dsh-base` on
first boot. Put the bot's credentials and access policy in the profile's own
patch layer (`$DSH_HOME/profiles/feishu/cordis.patch.yml`), then boot:

```sh
dsh --profile feishu
```

## Configuration

Layer this bundle behind `dsh-base` and mount the `feishu` row:

```yaml
- id: feishu
  name: '@aitechmei/dsh-feishu'
  config:
    appId: cli_xxx
    appSecret: '***'
    # optional
    verificationToken: '***'
    encryptKey: '***'
    domain: feishu        # feishu | lark
    dmPolicy: allowlist   # allowlist | open
    allowFrom: [ou_sender]
    groupPolicy: allowlist # allowlist | disabled | open
    groupAllowFrom: [oc_chat]
    requireMention: true
    provider: deepseek-official
    model: deepseek-v4-pro
    cwd: /path/to/workspace
```

| Key | Default | Meaning |
|---|---|---|
| `appId` / `appSecret` | — | Feishu open-platform app credentials (must be set). |
| `verificationToken` / `encryptKey` | — | Event-subscription verification and encryption, when the app uses them. |
| `domain` | `feishu` | `feishu` for `<...>.feishu.cn`, `lark` for `<...>.larksuite.com`. |
| `dmPolicy` | `allowlist` | `open` admits all direct messages; `allowlist` admits only `allowFrom`. |
| `allowFrom` | — | Sender open ids (`ou_…`) allowed to direct-message the bot. |
| `groupPolicy` | `allowlist` | `disabled` ignores groups; `allowlist` admits only `groupAllowFrom`; `open` admits all groups. |
| `groupAllowFrom` | — | Group chat ids (`oc_…`) admitted under `allowlist`. |
| `requireMention` | `true` | Require an @mention of the bot to trigger it in an admitted group. |
| `provider` / `model` | deployment default | Route for agents created for each chat. |
| `cwd` | host cwd | Working directory for created sessions. |

Credentials belong in the deployment `.env` through the `credentials` seam; the config should not inline secrets.

## Session binding

Each chat maps deterministically to one durable session id `feishu:<chat_id>`, so a conversation's history survives a process restart and the bot reuses a live agent across messages. A resumed or freshly created agent drives each chat; concurrent messages to the same chat queue in that agent's inbox in order. Access control is enforced before admission: bot-authored messages are ignored, DMs check `dmPolicy`/`allowFrom`, and groups check `groupPolicy`/`groupAllowFrom` plus the @mention gate.

## Events and extension points

The channel registers no new session event type. Admitted user messages carry a `feishu` `MessageSource` tag (`chatId`, `senderOpenId`, `messageId`) on the durable `user/message` event, so the model and any consumer can attribute a prompt without depending on live transport. Assistant replies are read from the ordinary `session/event` → `assistant/message` stream and delivered as plain-text Feishu messages.

## Model Experience

Indirectly, through the user messages it admits. The channel submits each admitted chat message verbatim as a normal user-role prompt through the agent loop and adds no prompt prose or schema of its own, so the model's context is exactly the deployment's composition plus the message text.

#### KV Cache effect

Independently, through the agent loop. The channel registers nothing that pins or replaces a request prefix; per-chat sessions keep their own history and the adapter's cache behavior is unchanged.

## Known Limitations and Deferred Work

- **Text replies only** — committed assistant text is relayed as a single Feishu text message. Streaming card replies, images, and rich `post` output are not implemented; a long reply is delivered as one (possibly large) message rather than streamed or chunked.
- **Webhook transport absent** — only the WebSocket long connection is available; a public-URL webhook mode is deferred.
- **Bot identity best-effort** — the bot's open id is resolved once at startup for @mention detection; a transient failure leaves group mention gating conservative (no group trigger) until a restart.
- **No Feishu workspace tools** — document/wiki/drive/Bitable tools from the OpenClaw channel are out of scope for this package.