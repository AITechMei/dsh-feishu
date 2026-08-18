import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ChatSessions, chatIdFromSession, FEISHU_SESSION_PREFIX, feishuSessionId } from '../src/sessions.ts'

describe('session id mapping', () => {
  it('maps a chat id to a deterministic session id and back', () => {
    const id = feishuSessionId('oc_chat')
    expect(id).toBe(`${FEISHU_SESSION_PREFIX}oc_chat`)
    expect(chatIdFromSession(id)).toBe('oc_chat')
    expect(chatIdFromSession(SessionId('other'))).toBeUndefined()
  })
})

describe('ChatSessions.agentFor', () => {
  it('reuses a live agent', async () => {
    const live = { id: 'x' }
    const ctx = { agents: { get: () => live } } as never
    const sessions = new ChatSessions(ctx, {})
    expect(await sessions.agentFor('oc_chat')).toBe(live)
  })

  it('creates a fresh agent when resume fails', async () => {
    const created = { id: 'feishu:oc_chat' }
    const ctx = {
      agents: {
        get: () => undefined,
        resume: async () => { throw new Error('not-found') },
        create: async () => ({ agent: created }),
      },
    } as never
    const sessions = new ChatSessions(ctx, { provider: 'p', model: 'm', cwd: '/w' })
    expect(await sessions.agentFor('oc_chat')).toBe(created)
    expect(sessions.isServing(feishuSessionId('oc_chat'))).toBe(true)
  })

  it('resumes a persisted agent', async () => {
    const resumed = { id: 'feishu:oc_chat' }
    const ctx = {
      agents: {
        get: () => undefined,
        resume: async () => ({ agent: resumed }),
      },
    } as never
    const sessions = new ChatSessions(ctx, {})
    expect(await sessions.agentFor('oc_chat')).toBe(resumed)
  })

  it('applies the deployment default model and installs its selection', async () => {
    let passedSetup: ((agentCtx: unknown) => void) | undefined
    const created = { id: 'feishu:oc_chat' }
    const ctx = {
      agents: {
        get: () => undefined,
        resume: async () => { throw new Error('not-found') },
        create: async (opts: { setup?: (agentCtx: unknown) => void }) => {
          passedSetup = opts.setup
          return { agent: created }
        },
      },
    } as never
    const sessions = new ChatSessions(ctx, {
      resolveDefaultModel: () => ({ provider: 'volcengine', model: 'ark-code-latest' }),
    })
    expect(await sessions.agentFor('oc_chat')).toBe(created)
    expect(passedSetup).toBeTypeOf('function')
    // Invoke the agent setup so the model selection is coupled to the agent scope.
    passedSetup!({ on: () => () => {} })
    expect(sessions.isServing(feishuSessionId('oc_chat'))).toBe(true)
  })

  it('deduplicates concurrent resolution for the same chat', async () => {
    let openings = 0
    const created = { id: 'feishu:oc_chat' }
    const ctx = {
      agents: {
        get: () => undefined,
        resume: async () => { throw new Error('not-found') },
        create: async () => { openings += 1; return { agent: created } },
      },
    } as never
    const sessions = new ChatSessions(ctx, {})
    const [a, b] = await Promise.all([sessions.agentFor('oc_chat'), sessions.agentFor('oc_chat')])
    expect(a).toBe(b)
    expect(openings).toBe(1)
  })
})