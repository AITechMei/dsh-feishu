/**
 * Feishu/Lark messaging bot channel. One plugin row connects the harness to a
 * Feishu app through the official Lark SDK WebSocket long connection, binds
 * each chat to a durable session, and relays assistant replies back as text.
 * @module @aitechmei/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createFeishuClient, createFeishuTransport, resolveBotOpenId } from './client.ts'
import { createMessageHandler } from './handler.ts'
import { installReplyRelay } from './relay.ts'
import { ChatSessions } from './sessions.ts'
import type { FeishuConfig } from './types.ts'

export type * from './types.ts'
export {
  createFeishuClient,
  createFeishuTransport,
  resolveBotOpenId,
  sendTextMessage,
  type LarkMessageReceiveEvent,
} from './client.ts'
export { isAdmissible } from './handler.ts'
export type { ChatSessionOptions } from './sessions.ts'

/** Cordis function-plugin name. */
export const name = 'feishu'
/** The agent registry is required to bind chat sessions. */
export const inject = ['agents']

/** Plugin config schema. */
export const Config: Schema<FeishuConfig> = Schema.object({
  appId: Schema.string().required(),
  appSecret: Schema.string().required(),
  verificationToken: Schema.string(),
  encryptKey: Schema.string(),
  domain: Schema.union(['feishu', 'lark']).default('feishu'),
  dmPolicy: Schema.union(['allowlist', 'open']).default('allowlist'),
  allowFrom: Schema.array(Schema.string()),
  groupPolicy: Schema.union(['allowlist', 'disabled', 'open']).default('allowlist'),
  groupAllowFrom: Schema.array(Schema.string()),
  requireMention: Schema.boolean(),
  provider: Schema.string(),
  model: Schema.string(),
  cwd: Schema.string(),
})

/**
 * Mount the Feishu messaging bot.
 * @param ctx - Cordis context carrying the agent registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: FeishuConfig): void {
  const client = createFeishuClient(config)
  const sessions = new ChatSessions(ctx, {
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    resolveDefaultModel: () => ctx.get('agentDefaultModel')?.currentSelection(),
  })

  let botOpenId: string | undefined
  let transport: { start: () => Promise<void>; stop: () => Promise<void> } | undefined

  ctx.effect(() => {
    const stopRelay = installReplyRelay({ ctx, client, sessions })
    const handler = createMessageHandler({
      ctx,
      config,
      sessions,
      botOpenId: () => botOpenId,
    })
    transport = createFeishuTransport(config, handler, {
      onReady: () => {
        ctx.logger.info('feishu: WebSocket long connection established')
      },
      onError: (error) => {
        ctx.logger.warn(`feishu: WebSocket connection error: ${String(error)}`)
      },
    })
    void resolveBotOpenId(client).then((openId) => {
      botOpenId = openId
      if (openId !== undefined) ctx.logger.info(`feishu: resolved bot open id ${openId}`)
    })
    void transport.start().catch((error: unknown) => {
      ctx.logger.error(`feishu: failed to start WebSocket connection: ${String(error)}`)
    })

    return async () => {
      stopRelay()
      await transport?.stop()
    }
  }, 'feishu.lifecycle()')
}