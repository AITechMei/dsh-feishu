/**
 * Outbound reply relay: forwards committed assistant messages from channel
 * sessions back to their Feishu chat as plain-text messages.
 * @module @aitechmei/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { FeishuClient } from './client.ts'
import { sendTextMessage } from './client.ts'
import type { ChatSessions } from './sessions.ts'
import { chatIdFromSession } from './sessions.ts'

/** Join the visible text blocks of one assistant message. */
function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  const parts: string[] = []
  for (const block of event.data.message.content) {
    if (block.type === 'text' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n\n')
}

/**
 * Install the relay: every committed assistant message on a served channel
 * session is delivered to its originating chat. Returns the disposer.
 * @param options.ctx - Cordis context broadcasting `session/event`.
 * @param options.client - Lark client used for outbound delivery.
 * @param options.sessions - the served chat-session registry.
 * @returns a disposer that stops the relay.
 */
export function installReplyRelay(options: {
  ctx: Context
  client: FeishuClient
  sessions: ChatSessions
}): () => void {
  const { ctx, client, sessions } = options
  return ctx.on('session/event', (session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return
    if (!sessions.isServing(session.id as SessionId)) return
    const chatId = chatIdFromSession(session.id as SessionId)
    if (chatId === undefined) return
    const text = assistantText(event)
    if (text.length === 0) return
    void sendTextMessage(client, chatId, text).catch((error: unknown) => {
      ctx.logger.warn(`feishu: reply to ${chatId} failed: ${String(error)}`)
    })
  })
}