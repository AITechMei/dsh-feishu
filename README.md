# feishu/ — Feishu/Lark messaging bot channel

English | [中文](README.zh.md)

`@aitechmei/dsh-feishu` connects the harness to a Feishu (or international Lark) app as a messaging bot. One plugin row subscribes to inbound messages through the official `@larksuiteoapi/node-sdk` WebSocket long connection (no public URL required), binds each chat to a durable harness session, and relays the agent's assistant replies back to the chat as natively rendered Markdown messages (with an optional DeepSeek brand header and a “thinking” reaction).

The flow mirrors how a server like the ACP bridge drives an agent: inbound text is admitted to a per-chat `Agent` via `agent.followup()`, and committed `assistant/message` session events are delivered back out. The channel is scoped to messaging (bot DMs and group chats, with @mention gating) and not to Feishu document/wiki/drive tools.

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

## Setup wizard

A guided CLI (`dsh-feishu-setup`, also `npx @aitechmei/dsh-feishu setup`) walks
you through connecting an account and writing it to the profile patch. It can
either **scan a QR to auto-create a bot** (Feishu's device-code flow, best-effort)
or **enter an existing appId/appSecret manually** (always available). It then
guides access policy and writes the `feishu` row into
`$DSH_HOME/profiles/<name>/cordis.patch.yml`, preserving every other row.

```sh
# interactive wizard for the default 'feishu' profile
dsh-feishu-setup
# explicit profile, dry-run (prints the patch, writes nothing), or scripted
dsh-feishu-setup --profile feishu-test --dry-run
dsh-feishu-setup --profile feishu-test --json --yes
```

| Flag | Meaning |
|---|---|
| `--profile <name>` | Target dsh profile (default `feishu`); it must already exist. |
| `--region <feishu|lark|auto>` | Preselect the platform (default interactive). |
| `--manual` | Skip QR scanning and enter credentials manually. |
| `--dry-run` | Print the patch that would be written; do not write. |
| `--json` | Emit a structured result on stdout. |
| `-y` / `--yes` | Use the recommended defaults and skip confirmations. |

After it writes, **restart dsh** to load the change. The scan path can auto
create a **personal** app owned by the scanning user's tenant; it has no team
backoffice quota guarantees and is best-effort. Manual entry of a self-built
app is the reliable, long-term configuration.

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
    brandHeader: '**🐋 DeepSeek**'   # optional brand prefix
    reactions: true                  # thinking Typing/CrossMark reaction
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
| `brandHeader` | `**🐋 DeepSeek**` | Brand text prepended to rich/long replies; an empty string disables it. |
| `reactions` | `true` | Show a “thinking” `Typing` reaction while working and a `CrossMark` on failure. Also gated by `FEISHU_REACTIONS` (off: `false`/`0`/`no`/`off`). |

Credentials belong in the deployment `.env` through the `credentials` seam; the config should not inline secrets.

## Session binding

Each chat maps deterministically to one durable session id `feishu:<chat_id>`, so a conversation's history survives a process restart and the bot reuses a live agent across messages. A resumed or freshly created agent drives each chat; concurrent messages to the same chat queue in that agent's inbox in order. Access control is enforced before admission: bot-authored messages are ignored, DMs check `dmPolicy`/`allowFrom`, and groups check `groupPolicy`/`groupAllowFrom` plus the @mention gate.

## Events and extension points

The channel registers no new session event type. Admitted user messages carry a `feishu` `MessageSource` tag (`chatId`, `senderOpenId`, `messageId`) on the durable `user/message` event, so the model and any consumer can attribute a prompt without depending on live transport. Assistant replies are read from the ordinary `session/event` → `assistant/message` stream and delivered as natively rendered Markdown (`msg_type: post` + `md`), falling back to plain text when the content is long or the API rejects the `post` payload. An optional `**🐋 DeepSeek**` brand header is prepended to rich or long replies. While an agent works, the bot places a `Typing` reaction on the inbound message and removes it (or swaps in a `CrossMark`) when the turn ends.

## Model Experience

Indirectly, through the user messages it admits. The channel submits each admitted chat message verbatim as a normal user-role prompt through the agent loop and adds no prompt prose or schema of its own, so the model's context is exactly the deployment's composition plus the message text.

#### KV Cache effect

Independently, through the agent loop. The channel registers nothing that pins or replaces a request prefix; per-chat sessions keep their own history and the adapter's cache behavior is unchanged.

## Known Limitations and Deferred Work

- **Markdown rendering is best-effort** — `post` + `md` renders headings, bold, lists and fenced code; **table rendering is not promised** (it may render or fall back to plain text, and is never force-downgraded). Streaming card replies, images, and interactive cards are not implemented; over-long replies are delivered as one large text message rather than streamed or chunked.
- **Reactions are best-effort** — `Typing`/`CrossMark` depend on the `im:message.reaction:*` scope and the Feishu static emoji token set; if the scope/emoji are unavailable the reaction is skipped and the reply still sends.
- **Webhook transport absent** — only the WebSocket long connection is available; a public-URL webhook mode is deferred.
- **Bot identity best-effort** — the bot's open id is resolved once at startup for @mention detection; a transient failure leaves group mention gating conservative (no group trigger) until a restart.
- **No Feishu workspace tools** — document/wiki/drive/Bitable tools are out of scope for this package.