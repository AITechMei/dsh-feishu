# feishu/ — 飞书／Lark 消息机器人渠道

[English](README.md) | 中文

`@aitechmei/dsh-feishu` 将 harness 连接到一个飞书（或国际版 Lark）应用，作为消息机器人运行。一个插件行位通过官方 `@larksuiteoapi/node-sdk` 的 WebSocket 长连接订阅入站消息（无需公网 URL），把每个聊天绑定到一个持久的 harness 会话，并把 agent 的 assistant 回复以飞书原生 Markdown（带可选的 DeepSeek 品牌前缀与“思考中”表情）回传给该聊天。

该流程与 ACP 桥等服务器驱动 agent 的方式一致：入站文本通过 `agent.followup()` 收进每个聊天的 `Agent`，已提交的 `assistant/message` 会话事件再回传出去。范围限定为消息（机器人私聊与群聊，带 @提及门槛），不包含飞书的文档／知识库／云文档工具。

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

## 配置向导

提供交互式 CLI（`dsh-feishu-setup`，也可 `npx @aitechmei/dsh-feishu setup`），
带你完成账号接入并写入 profile patch。既可以**扫码自动创建机器人**（飞书设备码
流程，尽力而为），也可以**手动录入已有的 appId/appSecret**（始终可用）。向导随后
引导访问策略，并把 `feishu` 行位写入 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，
保留其它行位不变。

```sh
# 默认 'feishu' profile 的交互向导
dsh-feishu-setup
# 显式 profile / 试运行（打印将写入的 patch，不写盘）/ 脚本化
dsh-feishu-setup --profile feishu-test --dry-run
dsh-feishu-setup --profile feishu-test --json --yes
```

| 参数 | 含义 |
|---|---|
| `--profile <name>` | 目标 dsh profile（默认 `feishu`）；须已存在。 |
| `--region <feishu|lark|auto>` | 预选平台（默认交互选择）。 |
| `--manual` | 跳过扫码，手动录入凭据。 |
| `--dry-run` | 只打印将写入的 patch，不写盘。 |
| `--json` | 向 stdout 输出结构化结果。 |
| `-y` / `--yes` | 使用推荐默认值并跳过确认。 |

写入后请**重启 dsh** 使改动生效。扫码路径自动创建的是扫码用户所在 tenant 下的
**个人**应用，无团队后台配额保证，属于尽力而为；手动录入自建应用才是可靠、长期的
配置方式。

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
    brandHeader: '**🐋 DeepSeek**'   # 可选品牌前缀
    reactions: true                  # 思考中 Typing/CrossMark 表情
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
| `brandHeader` | `**🐋 DeepSeek**` | 为富／长回复前置的品牌文本；空字符串表示关闭。 |
| `reactions` | `true` | 处理中显示“思考中” `Typing` 表情，失败时换成 `CrossMark`。也受 `FEISHU_REACTIONS` 开关控制（关闭值：`false`/`0`/`no`/`off`）。 |

凭据属于部署的 `.env`，通过 `credentials` seam 提供；配置不应内置机密。

## 会话绑定

每个聊天确定性地映射到一个持久的会话 id `feishu:<chat_id>`，因此对话历史在进程重启后仍保留，且机器人跨消息复用一个存活的 agent。一个恢复或新建的 agent 驱动每个聊天；对同一聊天的并发消息按顺序进入该 agent 的收件箱。准入前实施访问控制：忽略机器人自己发出的消息，私聊检查 `dmPolicy`/`allowFrom`，群聊检查 `groupPolicy`/`groupAllowFrom` 以及 @提及门槛。

## 事件与扩展点

该渠道不注册新的会话事件类型。被收下的用户消息在持久的 `user/message` 事件上携带 `feishu` 的 `MessageSource` 标签（`chatId`、`senderOpenId`、`messageId`），因此模型和任何消费方无需依赖实时传输即可归属一条提示。assistant 的回复从常规的 `session/event` → `assistant/message` 流读取，并以原生 Markdown（`msg_type: post` + `md`）发出；内容过长或 API 拒绝 `post` 载荷时降级为纯文本。可选的 `**🐋 DeepSeek**` 品牌前缀会加在富／长回复前。agent 处理时，机器人会在入站消息上加 `Typing` 表情，并在回合结束时移除（失败则换成 `CrossMark`）。

## 模型体验

间接地，通过它收下的用户消息体现。该渠道把每条被收下的聊天消息逐字提交为一条常规的用户角色提示进入 agent 循环，且不添加任何提示词或 schema，因此模型的上下文恰好是部署的组合加上消息文本。

#### KV Cache 效果

独立地，通过 agent 循环体现。该渠道不注册任何锁定或替换请求前缀的内容；每个聊天的会话各自保留自己的历史，适配器的缓存行为不变。

## 已知限制与延后工作

- **Markdown 渲染尽力而为** —— `post` + `md` 渲染标题、加粗、列表和围栏代码；**表格渲染不作承诺**（可能渲染，也可能降级为纯文本，但绝不强制降级）。流式卡片回复、图片、交互式卡片未实现；超长回复作为单条大文本发出，而非流式或分片。
- **表情尽力而为** —— `Typing`/`CrossMark` 依赖 `im:message.reaction:*` scope 与飞书封闭的静态 emoji 集合；scope 或 emoji 不可用时跳过表情，回复仍正常发送。
- **缺少 Webhook 传输** —— 仅提供 WebSocket 长连接；公网 URL 的 webhook 模式延后。
- **机器人身份尽力而为** —— 机器人的 open id 在启动时解析一次，用于 @提及检测；一次瞬时失败会让群聊提及门槛保持保守（不触发群聊），直到重启。
- **无飞书办公套件工具** —— 文档／知识库／云文档／多维表格工具不在本包范围内。