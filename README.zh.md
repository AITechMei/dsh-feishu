# feishu/ — 飞书／Lark 消息机器人渠道

[English](README.md) | 中文

`@aitechmei/dsh-feishu` 将 harness 连接到一个飞书（或国际版 Lark）应用，作为消息机器人运行。一个插件行位通过官方 `@larksuiteoapi/node-sdk` 的 WebSocket 长连接订阅入站消息（无需公网 URL），把每个聊天绑定到一个持久的 harness 会话，并把 agent 的 assistant 回复以纯文本消息回传给该聊天。

该流程与 ACP 桥等服务器驱动 agent 的方式一致：入站文本通过 `agent.followup()` 收进每个聊天的 `Agent`，已提交的 `assistant/message` 会话事件再回传出去。该渠道模型取自 OpenClaw 的飞书渠道，范围限定为消息（机器人私聊与群聊，带 @提及门槛），不包含飞书的文档／知识库／云文档工具。

## 安装

作为一个插件 bundle 安装到 dsh profile。profile 目录是 pnpm workspace 根，
所以 `pnpm add` 需要 `-w` 标志：

```sh
dsh plugin --profile feishu add -w @aitechmei/dsh-feishu
```

如果从插件源码目录挂载，用本地路径代替 registry 包名：

```sh
dsh plugin --profile feishu add -w file:/path/to/dsh-feishu
```

插件的 `dsh.bundle` patch 会在首次启动时把 `feishu` 行位插入到 `dsh-base`
之后。把机器人的凭据与访问策略写到 profile 自己的 patch 层
（`$DSH_HOME/profiles/feishu/cordis.patch.yml`），然后启动：

```sh
dsh --profile feishu
```

## 配置

将本 bundle 置于 `dsh-base` 之后，并挂载 `feishu` 行位：

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

| 键 | 默认 | 含义 |
|---|---|---|
| `appId` / `appSecret` | — | 飞书开放平台应用凭据（必须设置）。 |
| `verificationToken` / `encryptKey` | — | 事件订阅的校验与加密，当应用使用它们时。 |
| `domain` | `feishu` | `feishu` 对应 `<...>.feishu.cn`，`lark` 对应 `<...>.larksuite.com`。 |
| `dmPolicy` | `allowlist` | `open` 收下所有私聊；`allowlist` 仅收下 `allowFrom`。 |
| `allowFrom` | — | 允许私聊该机器人的发送者 open id（`ou_…`）。 |
| `groupPolicy` | `allowlist` | `disabled` 忽略群聊；`allowlist` 仅收下 `groupAllowFrom`；`open` 收下所有群聊。 |
| `groupAllowFrom` | — | 在 `allowlist` 下被收下的群聊 id（`oc_…`）。 |
| `requireMention` | `true` | 在被收下的群聊里要求 @提及机器人才能触发。 |
| `provider` / `model` | 部署默认 | 为每个聊天创建的 agent 的路由。 |
| `cwd` | 宿主 cwd | 创建会话的工作目录。 |

凭据属于部署的 `.env`，通过 `credentials` seam 提供；配置不应内置机密。

## 会话绑定

每个聊天确定性地映射到一个持久的会话 id `feishu:<chat_id>`，因此对话历史在进程重启后仍保留，且机器人跨消息复用一个存活的 agent。一个恢复或新建的 agent 驱动每个聊天；对同一聊天的并发消息按顺序进入该 agent 的收件箱。准入前实施访问控制：忽略机器人自己发出的消息，私聊检查 `dmPolicy`/`allowFrom`，群聊检查 `groupPolicy`/`groupAllowFrom` 以及 @提及门槛。

## 事件与扩展点

该渠道不注册新的会话事件类型。被收下的用户消息在持久的 `user/message` 事件上携带 `feishu` 的 `MessageSource` 标签（`chatId`、`senderOpenId`、`messageId`），因此模型和任何消费方无需依赖实时传输即可归属一条提示。assistant 的回复从常规的 `session/event` → `assistant/message` 流读取，并以纯文本飞书消息发出。

## 模型体验

间接地，通过它收下的用户消息体现。该渠道把每条被收下的聊天消息逐字提交为一条常规的用户角色提示进入 agent 循环，且不添加任何提示词或 schema，因此模型的上下文恰好是部署的组合加上消息文本。

#### KV Cache 效果

独立地，通过 agent 循环体现。该渠道不注册任何锁定或替换请求前缀的内容；每个聊天的会话各自保留自己的历史，适配器的缓存行为不变。

## 已知限制与延后工作

- **仅纯文本回复** —— 已提交的 assistant 文本以单条飞书文本消息回传。流式卡片回复、图片和富文本 `post` 输出未实现；长回复作为一条（可能很大的）消息发出，而非流式或分片。
- **缺少 Webhook 传输** —— 仅提供 WebSocket 长连接；公网 URL 的 webhook 模式延后。
- **机器人身份尽力而为** —— 机器人的 open id 在启动时解析一次，用于 @提及检测；一次瞬时失败会让群聊提及门槛保持保守（不触发群聊），直到重启。
- **无飞书办公套件工具** —— OpenClaw 渠道中的文档／知识库／云文档／多维表格工具不在本包范围内。