/**
 * Outbound reply relay: forwards committed assistant messages from channel
 * sessions back to their Feishu chat as rendered Markdown, and drives the
 * "thinking" reaction lifecycle on the original inbound message (remove
 * `Typing` on turn end, swap `CrossMark` on failure).
 * @module @aitechmei/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { FeishuClient } from './client.ts'
import { sendMarkdownMessage } from './client.ts'
import { applyBrandHeader, DEFAULT_BRAND_HEADER } from './format.ts'
import type { ReactionLifecycle } from './reaction.ts'
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

/** Options for the reply relay. */
export interface ReplyRelayOptions {
  ctx: Context
  client: FeishuClient
  sessions: ChatSessions
  reactions: ReactionLifecycle
  /** Brand header string; an empty string disables branding. */
  brandHeader?: string
}

/**
 * Install the relay: every committed assistant message on a served channel
 * session is delivered to its originating chat as rendered Markdown, and the
 * inbound message's `Typing` reaction is removed when the turn ends (with a
 * `CrossMark` on failure). Returns the disposer.
 */
export function installReplyRelay(
  options: ReplyRelayOptions,
): () => void {
  const { ctx, client, sessions, reactions } = options
  const brandHeader = options.brandHeader ?? DEFAULT_BRAND_HEADER
  const brandEnabled = brandHeader !== ''
  const inboundIds = new Map<string, string>() // sessionId -> inbound messageId

  return ctx.on('session/event', (session, event: SessionEvent) => {
    const sessionId = session.id as SessionId
    if (!sessions.isServing(sessionId)) return

    // Track the feishu inbound message so reactions can be removed on turn end.
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source !== undefined && source.kind === 'feishu') {
        inboundIds.set(sessionId, source.messageId)
      }
      return
    }

    const chatId = chatIdFromSession(sessionId)
    if (chatId === undefined) return

    if (event.type === 'assistant/message') {
      const text = assistantText(event)
      if (text.length === 0) return
      const content = applyBrandHeader(text, { header: brandHeader, enabled: brandEnabled })
      sendMarkdownMessage(client, chatId, content).catch((error: unknown) => {
        ctx.logger.warn(`feishu: reply to ${chatId} failed: ${String(error)}`)
      })
      return
    }

    if (event.type === 'turn/end') {
      const messageId = inboundIds.get(sessionId)
      inboundIds.delete(sessionId)
      if (messageId === undefined) return
      const failed = event.data.reason.kind === 'error'
      void reactions.finish(client, messageId, failed ? 'failure' : 'success').catch((error: unknown) => {
        ctx.logger.warn(`feishu: reaction cleanup for ${messageId} failed: ${String(error)}`)
      })
    }
  })
}
