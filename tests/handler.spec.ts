import { describe, expect, it } from 'vitest'
import { isAdmissible, createMessageHandler } from '../src/handler.ts'
import type { LarkMessageReceiveEvent } from '../src/client.ts'
import type { FeishuConfig } from '../src/types.ts'

function event(partial: Partial<LarkMessageReceiveEvent['message']> & { sender_type?: string } = {}): LarkMessageReceiveEvent {
  return {
    sender: { sender_type: partial.sender_type ?? 'user', sender_id: { open_id: 'ou_sender' } },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      ...partial,
    },
  } as LarkMessageReceiveEvent
}

const baseConfig: FeishuConfig = {
  appId: 'cli_x',
  appSecret: 's',
  dmPolicy: 'allowlist',
  allowFrom: ['ou_sender'],
  groupPolicy: 'allowlist',
  groupAllowFrom: ['oc_group'],
  requireMention: true,
}

describe('isAdmissible', () => {
  it('ignores bot-authored messages', () => {
    const e = event({ sender_type: 'app' })
    expect(isAdmissible(e, { ...baseConfig, dmPolicy: 'open', groupPolicy: 'open' }, undefined)).toBe(false)
  })

  it('admits an allowlisted DM and rejects an unknown DM', () => {
    const dm = event({ chat_type: 'p2p', chat_id: 'ou_chat' })
    expect(isAdmissible(dm, baseConfig, undefined)).toBe(true)
    const other = { ...dm, sender: { sender_type: 'user', sender_id: { open_id: 'ou_other' } } }
    expect(isAdmissible(other, baseConfig, undefined)).toBe(false)
  })

  it('admits all DMs under open policy', () => {
    const dm = event({ chat_type: 'p2p', chat_id: 'ou_chat' })
    expect(isAdmissible(dm, { ...baseConfig, dmPolicy: 'open' }, undefined)).toBe(true)
  })

  it('rejects disabled groups', () => {
    const g = event({ chat_type: 'group', chat_id: 'oc_group', mentions: [{ key: 'k', id: { open_id: 'ou_bot' }, name: 'bot' }] })
    expect(isAdmissible(g, { ...baseConfig, groupPolicy: 'disabled' }, 'ou_bot')).toBe(false)
  })

  it('rejects a group not in the allowlist', () => {
    const g = event({ chat_type: 'group', chat_id: 'oc_other', mentions: [{ key: 'k', id: { open_id: 'ou_bot' }, name: 'bot' }] })
    expect(isAdmissible(g, baseConfig, 'ou_bot')).toBe(false)
  })

  it('admits an allowlisted group only when the bot is mentioned', () => {
    const mentioned = event({ chat_type: 'group', chat_id: 'oc_group', mentions: [{ key: 'k', id: { open_id: 'ou_bot' }, name: 'bot' }] })
    expect(isAdmissible(mentioned, baseConfig, 'ou_bot')).toBe(true)
    const unmentioned = event({ chat_type: 'group', chat_id: 'oc_group' })
    expect(isAdmissible(unmentioned, baseConfig, 'ou_bot')).toBe(false)
  })

  it('admits group messages without a mention when requireMention is false', () => {
    const g = event({ chat_type: 'group', chat_id: 'oc_group' })
    expect(isAdmissible(g, { ...baseConfig, requireMention: false }, 'ou_bot')).toBe(true)
  })

  it('admits all groups under open policy', () => {
    const g = event({ chat_type: 'group', chat_id: 'oc_any', mentions: [{ key: 'k', id: { open_id: 'ou_bot' }, name: 'bot' }] })
    expect(isAdmissible(g, { ...baseConfig, groupPolicy: 'open' }, 'ou_bot')).toBe(true)
  })
})

describe('createMessageHandler text extraction', () => {
  it('extracts text messages and admits them', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => undefined, client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    await handler(event({ chat_type: 'p2p', chat_id: 'ou_chat' }))
    expect(followups).toHaveLength(1)
    const message = followups[0] as { content: [{ type: string; text: string }]; source: { kind: string; chatId: string } }
    expect(message.content[0].text).toBe('hello')
    expect(message.source).toMatchObject({ kind: 'feishu', chatId: 'ou_chat' })
  })

  it('extracts text from post messages', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => undefined, client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    const post = event({
      chat_type: 'p2p',
      message_type: 'post',
      content: JSON.stringify({ zh_cn: { title: 't', content: [[{ tag: 'text', text: 'rich ' }, { tag: 'text', text: 'text' }]] } }),
    })
    await handler(post)
    expect((followups[0] as { content: [{ text: string }] }).content[0].text).toBe('rich text')
  })

  it('ignores empty or unsupported content', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => undefined, client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    await handler(event({ message_type: 'image', content: '{}' }))
    await handler(event({ message_type: 'text', content: '{"text":"  "}' }))
    expect(followups).toHaveLength(0)
  })

  it('ignores malformed text and post content', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => undefined, client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    await handler(event({ message_type: 'text', content: '{not-json' }))
    await handler(event({ message_type: 'post', content: '{also-not-json' }))
    expect(followups).toHaveLength(0)
  })

  it('ignores a post with no text parts or a non-array content', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => undefined, client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    const noParts = event({ message_type: 'post', content: JSON.stringify({ zh_cn: { title: 't', content: [[{ tag: 'at', text: 'x' }]] } }) })
    await handler(noParts)
    const nonArray = event({ message_type: 'post', content: JSON.stringify({ zh_cn: { title: 't', content: 'nope' } }) })
    await handler(nonArray)
    expect(followups).toHaveLength(0)
  })

  it('ignores a text value that is not a string and a post line that is not an array', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => 'ou_bot', client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    await handler(event({ message_type: 'text', content: '{"text":123}' }))
    const badLine = event({ message_type: 'post', content: JSON.stringify({ zh_cn: { title: 't', content: ['not-an-array', 'also-not'] } }) })
    await handler(badLine)
    expect(followups).toHaveLength(0)
  })

  it('drops a message that is not admissible and one with no sender open id', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: baseConfig, sessions: sessions as never, botOpenId: () => 'ou_bot', client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    const notAllowed = event({ chat_type: 'p2p', chat_id: 'ou_chat' })
    notAllowed.sender = { sender_type: 'user', sender_id: { open_id: 'ou_stranger' } }
    await handler(notAllowed)
    const noSender = event({ chat_type: 'p2p', chat_id: 'ou_chat' })
    noSender.sender = { sender_type: 'user' }
    await handler(noSender)
    expect(followups).toHaveLength(0)
  })

  it('drops an admitted open-group message with no sender open id', async () => {
    const followups: unknown[] = []
    const sessions = { agentFor: async () => ({ followup: (m: unknown) => followups.push(m) }) }
    const ctx = { logger: { info: () => {} } } as never
    const handler = createMessageHandler({ ctx, config: { ...baseConfig, groupPolicy: 'open', requireMention: false }, sessions: sessions as never, botOpenId: () => 'ou_bot', client: {} as never, reactions: { start: async () => {}, finish: async () => {} } as never })
    const g = event({ chat_type: 'group', chat_id: 'oc_any' })
    g.sender = { sender_type: 'user' }
    await handler(g)
    expect(followups).toHaveLength(0)
  })
})