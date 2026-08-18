import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { installReplyRelay } from '../src/relay.ts'
import { feishuSessionId } from '../src/sessions.ts'

function assistantEvent(): SessionEvent {
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
        content: [{ type: 'text', text: 'the reply' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    },
  } as unknown as SessionEvent
}

describe('installReplyRelay', () => {
  it('delivers committed assistant text to the originating chat', async () => {
    const sent: string[] = []
    let handler: ((session: { id: SessionId }, event: SessionEvent) => void) | undefined
    const ctx = {
      on: (_name: string, fn: typeof handler) => { handler = fn; return () => { handler = undefined } },
      logger: { warn: () => {} },
    } as never
    const client = { im: { message: { create: async (p: { data: { content: string } }) => { sent.push(JSON.parse(p.data.content).text) } } } } as never
    const sessions = {
      isServing: (id: SessionId) => id === feishuSessionId('oc_chat'),
    } as never
    const dispose = installReplyRelay({ ctx, client, sessions })

    handler!({ id: feishuSessionId('oc_chat') }, assistantEvent())
    // A non-served session is ignored.
    handler!({ id: SessionId('other') }, assistantEvent())
    expect(sent).toEqual(['the reply'])

    dispose()
    expect(typeof dispose).toBe('function')
  })

  it('ignores non-assistant events and empty text', async () => {
    const sent: string[] = []
    let handler: ((session: { id: SessionId }, event: SessionEvent) => void) | undefined
    const ctx = {
      on: (_name: string, fn: typeof handler) => { handler = fn; return () => { handler = undefined } },
      logger: { warn: () => {} },
    } as never
    const client = { im: { message: { create: async (p: { data: { content: string } }) => { sent.push(JSON.parse(p.data.content).text) } } } } as never
    const sessions = { isServing: () => true } as never
    installReplyRelay({ ctx, client, sessions })

    handler!({ id: feishuSessionId('oc_chat') }, { type: 'turn/start', seq: 2, time: 1, data: { turn: 1 } } as SessionEvent)
    const empty = {
      ...assistantEvent(),
      data: { turn: 1, step: 1, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: '' }], source: { kind: 'model', provider: 'p', model: 'm' } } },
    } as unknown as SessionEvent
    handler!({ id: feishuSessionId('oc_chat') }, empty)
    expect(sent).toHaveLength(0)
  })

  it('ignores a served session that is not a feishu chat id', async () => {
    const sent: string[] = []
    let handler: ((session: { id: SessionId }, event: SessionEvent) => void) | undefined
    const ctx = {
      on: (_name: string, fn: typeof handler) => { handler = fn; return () => { handler = undefined } },
      logger: { warn: () => {} },
    } as never
    const client = { im: { message: { create: async (p: { data: { content: string } }) => { sent.push(JSON.parse(p.data.content).text) } } } } as never
    const sessions = { isServing: () => true } as never
    installReplyRelay({ ctx, client, sessions })
    handler!({ id: SessionId('other') }, assistantEvent())
    expect(sent).toHaveLength(0)
  })
})