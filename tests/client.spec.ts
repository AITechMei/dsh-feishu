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