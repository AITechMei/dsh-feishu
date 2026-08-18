import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDispatcher, mockWSClient } = vi.hoisted(() => ({
  mockDispatcher: { register: vi.fn() },
  mockWSClient: { start: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
}))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 'feishu', Lark: 'lark' },
  AppType: { SelfBuild: 'self-build' },
  LoggerLevel: { warn: 'warn' },
  EventDispatcher: vi.fn(function () { return mockDispatcher }),
  WSClient: vi.fn(function () { return mockWSClient }),
  Client: vi.fn(),
}))

import * as Lark from '@larksuiteoapi/node-sdk'
import { createFeishuClient, createFeishuTransport, resolveBotOpenId } from '../src/client.ts'

describe('createFeishuClient', () => {
  it('builds a self-build client with the resolved domain', () => {
    const client = createFeishuClient({ appId: 'cli_x', appSecret: 's', domain: 'lark' })
    expect(client).toBeInstanceOf(Lark.Client)
  })
})

describe('resolveBotOpenId', () => {
  it('returns the bot open id from the bot-info endpoint', async () => {
    const client = { request: vi.fn().mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } }) } as unknown as Lark.Client
    await expect(resolveBotOpenId(client)).resolves.toBe('ou_bot')
  })

  it('returns undefined when the bot-info endpoint is absent or fails', async () => {
    const missing = { request: vi.fn().mockResolvedValue({ code: 0 }) } as unknown as Lark.Client
    await expect(resolveBotOpenId(missing)).resolves.toBeUndefined()
    const failing = { request: vi.fn().mockRejectedValue(new Error('network')) } as unknown as Lark.Client
    await expect(resolveBotOpenId(failing)).resolves.toBeUndefined()
  })
})

describe('createFeishuTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the receive handler and binds the WebSocket lifecycle', async () => {
    const onMessage = vi.fn()
    const transport = createFeishuTransport({ appId: 'cli_x', appSecret: 's' }, onMessage)
    expect(Lark.EventDispatcher).toHaveBeenCalledWith({})
    expect(mockDispatcher.register).toHaveBeenCalledWith({ 'im.message.receive_v1': onMessage })

    await transport.start()
    expect(Lark.WSClient).toHaveBeenCalledWith(expect.objectContaining({ appId: 'cli_x', appSecret: 's' }))
    expect(mockWSClient.start).toHaveBeenCalledWith({ eventDispatcher: mockDispatcher })

    await transport.stop()
    expect(mockWSClient.close).toHaveBeenCalledWith({ force: true })
  })

  it('passes verification, encryption, and lifecycle callbacks through', () => {
    const onReady = vi.fn()
    const onError = vi.fn()
    createFeishuTransport(
      { appId: 'cli_x', appSecret: 's', verificationToken: 'vt', encryptKey: 'ek', domain: 'lark' },
      vi.fn(),
      { onReady, onError },
    )
    expect(Lark.EventDispatcher).toHaveBeenCalledWith({ encryptKey: 'ek', verificationToken: 'vt' })
    expect(Lark.WSClient).toHaveBeenCalledWith(expect.objectContaining({ domain: Lark.Domain.Lark, onReady, onError }))
  })
})