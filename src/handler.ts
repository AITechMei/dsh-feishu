/**
 * Inbound message handling: raw event parsing, access control, and admission
 * into the per-chat agent. It owns nothing durable — the session it drives
 * does — and every admission is a reversible effect of the owning plugin.
 * @module @aitechmei/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LarkMessageReceiveEvent } from './client.ts'
import type { ChatSessions } from './sessions.ts'
import type { FeishuConfig } from './types.ts'

/** How a message text is carried by the two supported message types. */
function extractText(messageType: string, contentJson: string): string | undefined {
  if (messageType === 'text') {
    try {
      const parsed = JSON.parse(contentJson) as { text?: unknown }
      return typeof parsed.text === 'string' ? parsed.text : undefined
    } catch {
      return undefined
    }
  }
  if (messageType === 'post') {
    try {
      const parsed = JSON.parse(contentJson) as {
        [lang: string]: { title?: unknown; content?: unknown }
      }
      for (const lang of Object.keys(parsed)) {
        const block = parsed[lang]
        if (block === undefined || !Array.isArray(block.content)) continue
        const parts: string[] = []
        for (const line of block.content) {
          if (!Array.isArray(line)) continue
          for (const node of line) {
            const n = node as { tag?: unknown; text?: unknown }
            if (n.tag === 'text' && typeof n.text === 'string' && n.text.length > 0) {
              parts.push(n.text)
            }
          }
        }
        if (parts.length > 0) return parts.join('')
      }
      return undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Whether the message was authored by an app/bot rather than a human. */
function isBotAuthored(event: LarkMessageReceiveEvent): boolean {
  return event.sender.sender_type === 'app'
}

/** Whether the message mentions the bot (used for group mention gating). */
function mentionsBot(event: LarkMessageReceiveEvent, botOpenId: string | undefined): boolean {
  const mentions = event.message.mentions
  if (mentions === undefined) return false
  return mentions.some(mention => mention.id.open_id === botOpenId)
}

/** Decide whether an inbound message may be admitted under the access policy. */
export function isAdmissible(
  event: LarkMessageReceiveEvent,
  config: FeishuConfig,
  botOpenId: string | undefined,
): boolean {
  if (isBotAuthored(event)) return false
  const senderOpenId = event.sender.sender_id?.open_id
  const chatId = event.message.chat_id
  const chatType = event.message.chat_type
  if (chatType === 'p2p') {
    return config.dmPolicy !== 'open'
      ? (senderOpenId !== undefined && config.allowFrom?.includes(senderOpenId) === true)
      : true
  }
  // Group chats.
  if (config.groupPolicy === 'disabled') return false
  const groupAdmitted = config.groupPolicy === 'open'
    || config.groupAllowFrom?.includes(chatId) === true
  if (!groupAdmitted) return false
  if (config.requireMention === false) return true
  return mentionsBot(event, botOpenId)
}

/** Build the inbound event handler that admits messages into per-chat agents. */
export function createMessageHandler(options: {
  ctx: Context
  config: FeishuConfig
  sessions: ChatSessions
  botOpenId: () => string | undefined
}): (event: LarkMessageReceiveEvent) => Promise<void> {
  const { ctx, config, sessions, botOpenId } = options
  return async (event) => {
    const text = extractText(event.message.message_type, event.message.content)
    if (text === undefined || text.trim().length === 0) return
    if (!isAdmissible(event, config, botOpenId())) return
    const senderOpenId = event.sender.sender_id?.open_id
    if (senderOpenId === undefined) return
    const chatId = event.message.chat_id
    const agent = await sessions.agentFor(chatId)
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'feishu',
        chatId,
        senderOpenId,
        messageId: event.message.message_id,
      },
    })
    agent.followup(message)
    ctx.logger.info(
      `feishu: admitted ${event.message.message_type} message ${event.message.message_id} `
      + `from ${senderOpenId} in ${chatId} to session ${agent.id}`,
    )
  }
}