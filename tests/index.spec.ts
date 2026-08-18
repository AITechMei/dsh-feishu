import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateClient,
  mockCreateTransport,
  mockResolveBotOpenId,
  mockSendText,
  mockInstallRelay,
  mockCreateHandler,
  mockChatSessions,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateTransport: vi.fn(),
  mockResolveBotOpenId: vi.fn(),
  mockSendText: vi.fn(),
  mockInstallRelay: vi.fn(() => vi.fn()),
  mockCreateHandler: vi.fn((opts: { botOpenId: () => unknown }) => { opts.botOpenId(); return vi.fn() }),
  mockChatSessions: vi.fn(),
}))

vi.mock('../src/client.ts', () => ({
  createFeishuClient: mockCreateClient,
  createFeishuTransport: mockCreateTransport,
  resolveBotOpenId: mockResolveBotOpenId,
  sendTextMessage: mockSendText,
}))
vi.mock('../src/relay.ts', () => ({ installReplyRelay: mockInstallRelay }))
vi.mock('../src/handler.ts', () => ({ createMessageHandler: mockCreateHandler, isAdmissible: vi.fn(() => true) }))
vi.mock('../src/sessions.ts', () => ({ ChatSessions: mockChatSessions }))

import { apply, Config, inject, name } from '../src/index.ts'

function makeCtx() {
  const effectFn: { fn?: () => () => Promise<void> } = {}
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const defaultModel = { currentSelection: vi.fn() }
  const get = vi.fn(() => defaultModel)
  const ctx = {
    effect: (fn: () => () => Promise<void>) => { effectFn.fn = fn },
    logger,
    get,
  }
  return { ctx: ctx as never, effectFn, logger, defaultModel, get }
}

function makeTransport() {
  return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
}

describe('feishu plugin wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('declares the plugin name and required agent registry', () => {
    expect(name).toBe('feishu')
    expect(inject).toEqual(['agents'])
  })

  it('validates config and rejects a missing app secret', () => {
    const valid = Config({ appId: 'cli_x', appSecret: 's' })
    expect(valid.appId).toBe('cli_x')
    expect(() => Config({ appId: 'cli_x' } as never)).toThrow()
  })

  it('mounts client, sessions, relay, transport, and bot identity within an effect', async () => {
    const client = { request: vi.fn() }
    mockCreateClient.mockReturnValue(client)
    const transport = makeTransport()
    mockCreateTransport.mockReturnValue(transport)
    mockResolveBotOpenId.mockResolvedValue('ou_bot')
    const { ctx, effectFn, logger } = makeCtx()

    apply(ctx, { appId: 'cli_x', appSecret: 's' })
    expect(effectFn.fn).toEqual(expect.any(Function))

    const disposer = effectFn.fn!()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockCreateClient).toHaveBeenCalledWith({ appId: 'cli_x', appSecret: 's' })
    expect(mockCreateTransport).toHaveBeenCalled()
    expect(mockResolveBotOpenId).toHaveBeenCalledWith(client)
    expect(mockCreateHandler).toHaveBeenCalled()
    expect(mockInstallRelay).toHaveBeenCalled()
    expect(transport.start).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('feishu: resolved bot open id ou_bot')

    await disposer()
    expect(transport.stop).toHaveBeenCalled()
  })

  it('logs transport lifecycle callbacks and a start failure', async () => {
    const client = { request: vi.fn() }
    mockCreateClient.mockReturnValue(client)
    const transport = makeTransport()
    transport.start.mockRejectedValue(new Error('boom'))
    let callbacks: { onReady?: () => void; onError?: (e: Error) => void } | undefined
    mockCreateTransport.mockImplementation((_config, _h, cb) => { callbacks = cb; return transport })
    mockResolveBotOpenId.mockResolvedValue(undefined)
    const { ctx, effectFn, logger } = makeCtx()

    apply(ctx, { appId: 'cli_x', appSecret: 's', provider: 'p', model: 'm', cwd: '/w' })
    const disposer = effectFn.fn!()
    callbacks!.onReady!()
    callbacks!.onError!(new Error('net'))
    await Promise.resolve()
    await Promise.resolve()

    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ appId: 'cli_x', appSecret: 's' }))
    expect(logger.info).toHaveBeenCalledWith('feishu: WebSocket long connection established')
    expect(logger.warn).toHaveBeenCalledWith('feishu: WebSocket connection error: Error: net')
    expect(logger.error).toHaveBeenCalledWith('feishu: failed to start WebSocket connection: Error: boom')
    await disposer()
  })

  it('resolves the deployment default model for created chat agents', () => {
    mockChatSessions.mockClear()
    const { ctx, defaultModel, get } = makeCtx()
    defaultModel.currentSelection.mockReturnValue({ provider: 'volcengine', model: 'ark-code-latest' })
    apply(ctx, { appId: 'cli_x', appSecret: 's' })
    const options = mockChatSessions.mock.calls[0]![1] as { resolveDefaultModel?: () => unknown }
    expect(options.resolveDefaultModel).toBeTypeOf('function')
    expect(options.resolveDefaultModel!()).toEqual({ provider: 'volcengine', model: 'ark-code-latest' })
    expect(get).toHaveBeenCalledWith('agentDefaultModel')
  })
})