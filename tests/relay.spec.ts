import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { installReplyRelay } from '../src/relay.ts'
import { feishuSessionId } from '../src/sessions.ts'

function assistantEvent(content: string = 'the reply'): SessionEvent {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 1,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'm',
        role: 'assistant',
        content: [{ type: 'text', text: content }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    },
  } as unknown as SessionEvent
}

function userMessageEvent(messageId: string, chatId = 'oc_chat'): SessionEvent {
  return {
    type: 'user/message',
    seq: 0,
    time: 0,
    data: {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'feishu', chatId, senderOpenId: 'ou_1', messageId },
    },
  } as unknown as SessionEvent
}

function turnEndEvent(reasonKind: string): SessionEvent {
  return {
    type: 'turn/end',
    seq: 2,
    time: 2,
    data: { turn: 1, reason: { kind: reasonKind } },
  } as unknown as SessionEvent
}

function makeClient() {
  const sent: Array<{ msgType: string; content: string }> = []
  const client = {
    im: {
      message: {
        create: async (payload: { data: { msg_type: string; content: string } }) => {
          sent.push({ msgType: payload.data.msg_type, content: payload.data.content })
          return { code: 0 }
        },
      },
    },
  }
  return { client, sent }
}

function makeContext() {
  let handler: ((session: { id: SessionId }, event: SessionEvent) => void) | undefined
  return {
    ctx: {
      on: (_name: string, fn: typeof handler) => { handler = fn; return () => { handler = undefined } },
      logger: { warn: () => {} },
    } as never,
    handler: () => handler!,
  }
}

describe('installReplyRelay', () => {
  it('delivers committed assistant text to the originating chat as text (no markdown hint)', async () => {
    const { client, sent } = makeClient()
    const { ctx, handler } = makeContext()
    const reactions = { finish: vi.fn() } as never
    const dispose = installReplyRelay({ ctx, client: client as never, sessions: { isServing: (id: SessionId) => id === feishuSessionId('oc_chat') } as never, reactions })

    handler()({ id: feishuSessionId('oc_chat') }, assistantEvent())
    handler()({ id: SessionId('other') }, assistantEvent())
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0].content)).toEqual({ text: 'the reply' })
    dispose()
  })

  it('delivers rich markdown as post', async () => {
    const { client, sent } = makeClient()
    const { ctx, handler } = makeContext()
    installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions: {} as never, brandHeader: '' })
    handler()({ id: feishuSessionId('oc_chat') }, assistantEvent('**bold**'))
    expect(sent[0].msgType).toBe('post')
    expect(JSON.parse(sent[0].content)).toMatchObject({ zh_cn: { content: [[{ tag: 'md', text: '**bold**' }]] } })
  })

  it('prepends the brand header to rich replies', async () => {
    const { client, sent } = makeClient()
    const { ctx, handler } = makeContext()
    installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions: {} as never, brandHeader: '**🐋 DeepSeek**' })
    handler()({ id: feishuSessionId('oc_chat') }, assistantEvent('## heading'))
    const text = JSON.parse(sent[0].content).zh_cn.content[0][0].text
    expect(text).toContain('🐋 DeepSeek')
    expect(text).toContain('## heading')
  })

  it('ignores non-assistant events and empty text', async () => {
    const { client, sent } = makeClient()
    const { ctx, handler } = makeContext()
    installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions: {} as never })
    handler()({ id: feishuSessionId('oc_chat') }, { type: 'turn/start', seq: 2, time: 1, data: { turn: 1 } } as unknown as SessionEvent)
    const empty = { ...assistantEvent(''), data: { turn: 1, step: 1, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: '' }], source: { kind: 'model', provider: 'p', model: 'm' } } } } as unknown as SessionEvent
    handler()({ id: feishuSessionId('oc_chat') }, empty)
    expect(sent).toHaveLength(0)
  })

  it('ignores a served session that is not a feishu chat id', async () => {
    const { client, sent } = makeClient()
    const { ctx, handler } = makeContext()
    installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions: {} as never })
    handler()({ id: SessionId('other') }, assistantEvent())
    expect(sent).toHaveLength(0)
  })

  describe('reaction lifecycle', () => {
    it('finishes success on turn end', async () => {
      const { client } = makeClient()
      const { ctx, handler } = makeContext()
      const reactions = { finish: vi.fn().mockResolvedValue(undefined) } as never
      installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions })
      handler()({ id: feishuSessionId('oc_chat') }, userMessageEvent('om_in'))
      handler()({ id: feishuSessionId('oc_chat') }, assistantEvent('ok'))
      handler()({ id: feishuSessionId('oc_chat') }, turnEndEvent('completed'))
      expect(reactions.finish).toHaveBeenCalledWith(client, 'om_in', 'success')
    })

    it('finishes failure (CrossMark) when the turn errored', async () => {
      const { client } = makeClient()
      const { ctx, handler } = makeContext()
      const reactions = { finish: vi.fn().mockResolvedValue(undefined) } as never
      installReplyRelay({ ctx, client: client as never, sessions: { isServing: () => true } as never, reactions })
      handler()({ id: feishuSessionId('oc_chat') }, userMessageEvent('om_in'))
      handler()({ id: feishuSessionId('oc_chat') }, turnEndEvent('error'))
      expect(reactions.finish).toHaveBeenCalledWith(client, 'om_in', 'failure')
    })
  })
})
