import { describe, expect, it } from 'vitest'
import { resolveSdkDomain, sendTextMessage } from '../src/client.ts'
import * as Lark from '@larksuiteoapi/node-sdk'

describe('resolveSdkDomain', () => {
  it('defaults to Feishu and maps lark', () => {
    expect(resolveSdkDomain(undefined)).toBe(Lark.Domain.Feishu)
    expect(resolveSdkDomain('feishu')).toBe(Lark.Domain.Feishu)
    expect(resolveSdkDomain('lark')).toBe(Lark.Domain.Lark)
  })
})

describe('sendTextMessage', () => {
  it('skips empty text', async () => {
    const client = { im: { message: { create: () => { throw new Error('should not be called') } } } } as unknown as Lark.Client
    await sendTextMessage(client, 'oc_chat', '')
  })

  it('delivers text and throws on a non-zero code', async () => {
    const seen: unknown[] = []
    const client = { im: { message: { create: async (payload: unknown) => { seen.push(payload); return { code: 0 } } } } } as unknown as Lark.Client
    await sendTextMessage(client, 'oc_chat', 'hello')
    expect(seen).toEqual([
      {
        data: { receive_id: 'oc_chat', msg_type: 'text', content: JSON.stringify({ text: 'hello' }) },
        params: { receive_id_type: 'chat_id' },
      },
    ])
    const failing = { im: { message: { create: async () => ({ code: 999, msg: 'boom' }) } } } as unknown as Lark.Client
    await expect(sendTextMessage(failing, 'oc_chat', 'x')).rejects.toThrow(/999 boom/)
    const noMsg = { im: { message: { create: async () => ({ code: 1 }) } } } as unknown as Lark.Client
    await expect(sendTextMessage(noMsg, 'oc_chat', 'x')).rejects.toThrow(/^feishu message delivery failed: 1 $/)
  })

  it('does not throw when the response omits a code', async () => {
    const noCode = { im: { message: { create: async () => ({}) } } } as unknown as Lark.Client
    await expect(sendTextMessage(noCode, 'oc_chat', 'x')).resolves.toBeUndefined()
  })
})
import {
  addMessageReaction,
  removeMessageReaction,
  REACTION_CROSS,
  REACTION_TYPING,
  sendMarkdownMessage,
} from '../src/client.ts'

describe('sendMarkdownMessage', () => {
  it('sends plain prose as text', async () => {
    const seen: unknown[] = []
    const client = { im: { message: { create: async (payload: unknown) => { seen.push(payload); return { code: 0 } } } } } as unknown as Lark.Client
    await sendMarkdownMessage(client, 'oc_chat', 'plain reply')
    expect((seen[0] as { data: { msg_type: string; content: string } }).data.msg_type).toBe('text')
    expect(JSON.parse((seen[0] as never as { data: { content: string } }).data.content)).toEqual({ text: 'plain reply' })
  })

  it('sends rich markdown as post', async () => {
    const seen: unknown[] = []
    const client = { im: { message: { create: async (payload: unknown) => { seen.push(payload); return { code: 0 } } } } } as unknown as Lark.Client
    await sendMarkdownMessage(client, 'oc_chat', '**bold**')
    const data = (seen[0] as never as { data: { msg_type: string; content: string } }).data
    expect(data.msg_type).toBe('post')
    expect(JSON.parse(data.content)).toMatchObject({ zh_cn: { content: [[{ tag: 'md', text: '**bold**' }]] } })
  })

  it('falls back to text when the API rejects the post payload', async () => {
    const seen: unknown[] = []
    const client = {
      im: {
        message: {
          create: async (payload: { data: { msg_type: string; content: string } }) => {
            seen.push(payload.data.msg_type)
            if (payload.data.msg_type === 'post') {
              return { code: 190001, msg: 'content format of the post type is incorrect' }
            }
            return { code: 0 }
          },
        },
      },
    } as unknown as Lark.Client
    await expect(sendMarkdownMessage(client, 'oc_chat', '**bold**')).resolves.toBeUndefined()
    expect(seen[seen.length - 1]).toBe('text')
  })

  it('downgrades over-length content to a plain text send', async () => {
    const seen: unknown[] = []
    const client = { im: { message: { create: async (payload: unknown) => { seen.push(payload); return { code: 0 } } } } } as unknown as Lark.Client
    const long = 'x'.repeat(9000)
    await sendMarkdownMessage(client, 'oc_chat', long)
    expect((seen[0] as never as { data: { msg_type: string } }).data.msg_type).toBe('text')
  })

  it('skips empty content', async () => {
    const client = { im: { message: { create: async () => { throw new Error('should not be called') } } } } as unknown as Lark.Client
    await expect(sendMarkdownMessage(client, 'oc_chat', '')).resolves.toBeUndefined()
  })
})

describe('message reactions', () => {
  it('adds a reaction and returns the reaction id', async () => {
    const client = {
      im: {
        messageReaction: {
          create: async () => ({ code: 0, data: { reaction_id: 'rid-9' } }),
        },
      },
    } as unknown as Lark.Client
    await expect(addMessageReaction(client, 'om_1', REACTION_TYPING)).resolves.toBe('rid-9')
  })

  it('returns undefined when the add fails or throws', async () => {
    const failing = { im: { messageReaction: { create: async () => ({ code: 999 }) } } } as unknown as Lark.Client
    await expect(addMessageReaction(failing, 'om_1', REACTION_TYPING)).resolves.toBeUndefined()
    const throwing = { im: { messageReaction: { create: async () => { throw new Error('x') } } } } as unknown as Lark.Client
    await expect(addMessageReaction(throwing, 'om_1', REACTION_TYPING)).resolves.toBeUndefined()
  })

  it('removes a reaction and reports status', async () => {
    const ok = { im: { messageReaction: { delete: async () => ({ code: 0 }) } } } as unknown as Lark.Client
    await expect(removeMessageReaction(ok, 'om_1', 'rid-1')).resolves.toBe(true)
    const bad = { im: { messageReaction: { delete: async () => ({ code: 1 }) } } } as unknown as Lark.Client
    await expect(removeMessageReaction(bad, 'om_1', 'rid-1')).resolves.toBe(false)
  })

  it('exports the reaction emoji tokens', () => {
    expect(REACTION_TYPING).toBe('Typing')
    expect(REACTION_CROSS).toBe('CrossMark')
  })
})
