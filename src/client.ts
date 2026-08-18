/**
 * Lark SDK transport: client, event dispatcher, WebSocket long connection,
 * and text delivery. The default transport is the WebSocket long connection,
 * which needs no public URL; webhook mode is not implemented in this package.
 * @module @aitechmei/dsh-feishu
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import {
  MAX_MESSAGE_LENGTH,
  POST_CONTENT_INVALID_RE,
  buildOutboundPayload,
  stripMarkdownToPlainText,
} from './format.ts'
import type { FeishuDomain } from './types.ts'

/** Inbound `im.message.receive_v1` payload as the SDK hands it to a handler. */
export type LarkMessageReceiveEvent = {
  event_id?: string
  sender: {
    sender_id?: { union_id?: string; user_id?: string; open_id?: string }
    sender_type: string
  }
  message: {
    message_id: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
  }
}

/** The Lark API client this channel uses for outbound delivery. */
export type FeishuClient = Lark.Client

/** Map the plugin's domain tag to the SDK domain enum. */
export function resolveSdkDomain(domain: FeishuDomain | undefined): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

/** Build the API client used for outbound message delivery. */
export function createFeishuClient(config: {
  appId: string
  appSecret: string
  domain?: FeishuDomain
}): Lark.Client {
  return new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveSdkDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.warn,
  })
}

/** The bot-info response body returned by `GET /open-apis/bot/v3/info`. */
interface BotInfoResponse {
  code?: number
  bot?: { open_id?: string }
}

/**
 * Resolve the bot's own open id from `GET /open-apis/bot/v3/info`. Used to
 * detect @mentions of the bot in group messages.
 * @param client - Lark client authenticated as the app.
 * @returns the bot's open id, or undefined when the endpoint cannot be reached.
 */
export async function resolveBotOpenId(client: Lark.Client): Promise<string | undefined> {
  try {
    const response = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' }) as BotInfoResponse
    return response.bot?.open_id
  } catch {
    return undefined
  }
}

/** Create one message of the given type and throw on a non-zero API code. */
export async function createMessage(
  client: Lark.Client,
  chatId: string,
  msgType: 'text' | 'post',
  content: string,
): Promise<void> {
  const result = await client.im.message.create({
    data: { receive_id: chatId, msg_type: msgType, content },
    params: { receive_id_type: 'chat_id' },
  })
  if (result.code !== undefined && result.code !== 0) {
    throw new Error(`feishu message delivery failed: ${result.code} ${result.msg ?? ''}`)
  }
}

/** Send one plain-text message to a chat (group or p2p) by chat id. */
export async function sendTextMessage(
  client: Lark.Client,
  chatId: string,
  text: string,
): Promise<void> {
  if (text.length === 0) return
  await createMessage(client, chatId, 'text', JSON.stringify({ text }))
}

/**
 * Send a reply using Feishu native Markdown (`post` + `md`) when the content
 * has rich markup, otherwise plain text. Whole content over the length ceiling
 * is sent as text (not forcibly multi-part). If the API rejects the `post`
 * payload, fall back to plain text.
 */
export async function sendMarkdownMessage(
  client: Lark.Client,
  chatId: string,
  content: string,
  options: { preferPost?: boolean } = {},
): Promise<void> {
  if (content.length === 0) return
  if (content.length > MAX_MESSAGE_LENGTH) {
    await sendTextMessage(client, chatId, content)
    return
  }
  const payload = buildOutboundPayload(content, options)
  if (payload.msgType === 'text') {
    await sendTextMessage(client, chatId, content)
    return
  }
  try {
    await createMessage(client, chatId, 'post', payload.content)
  } catch (error) {
    if (!POST_CONTENT_INVALID_RE.test(String(error))) throw error
    await sendTextMessage(client, chatId, stripMarkdownToPlainText(content))
  }
}

/** Emoji tokens the channel uses for processing status (Feishu static set). */
export const REACTION_TYPING = 'Typing'
/** Failure badge swapped in when a reply errors. */
export const REACTION_CROSS = 'CrossMark'

/**
 * Add an emoji reaction to a message. Returns the opaque `reaction_id` needed
 * to delete it later, or undefined when the add failed.
 */
export async function addMessageReaction(
  client: Lark.Client,
  messageId: string,
  emojiType: string,
): Promise<string | undefined> {
  try {
    const result = await client.im.messageReaction.create({
      data: { reaction_type: { emoji_type: emojiType } },
      path: { message_id: messageId },
    })
    if (result === null) return undefined
    if (result.code !== undefined && result.code !== 0) return undefined
    return result.data?.reaction_id
  } catch {
    return undefined
  }
}

/** Remove a reaction by its id. Returns false when the delete failed. */
export async function removeMessageReaction(
  client: Lark.Client,
  messageId: string,
  reactionId: string,
): Promise<boolean> {
  try {
    const result = await client.im.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    })
    if (result === null) return false
    if (result.code !== undefined && result.code !== 0) return false
    return true
  } catch {
    return false
  }
}

/** Transport lifecycle callbacks a plugin may observe. */
export interface FeishuTransportCallbacks {
  onReady?: () => void
  onError?: (error: Error) => void
}

/** Create the event dispatcher and WebSocket long connection for an account. */
export function createFeishuTransport(
  config: { appId: string; appSecret: string; verificationToken?: string; encryptKey?: string; domain?: FeishuDomain },
  onMessage: (event: LarkMessageReceiveEvent) => void | Promise<void>,
  callbacks: FeishuTransportCallbacks = {},
): { start: () => Promise<void>; stop: () => Promise<void> } {
  const dispatcher = new Lark.EventDispatcher({
    ...(config.encryptKey === undefined ? {} : { encryptKey: config.encryptKey }),
    ...(config.verificationToken === undefined ? {} : { verificationToken: config.verificationToken }),
  })
  dispatcher.register({ 'im.message.receive_v1': onMessage })

  const wsClient = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: resolveSdkDomain(config.domain),
    loggerLevel: Lark.LoggerLevel.warn,
    ...(callbacks.onReady === undefined ? {} : { onReady: callbacks.onReady }),
    ...(callbacks.onError === undefined ? {} : { onError: callbacks.onError }),
  })

  return {
    start: () => wsClient.start({ eventDispatcher: dispatcher }),
    stop: () => {
      wsClient.close({ force: true })
      return Promise.resolve()
    },
  }
}