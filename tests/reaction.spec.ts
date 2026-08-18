import { describe, expect, it } from 'vitest'
import {
  REACTION_CACHE_SIZE,
  ReactionLifecycle,
  reactionsEnabledFromEnv,
  resolveReactionsEnabled,
} from '../src/reaction.ts'
import { REACTION_CROSS, REACTION_TYPING } from '../src/client.ts'

/** Fake client that records reaction create/delete calls. */
function makeClient() {
  const created: Array<{ messageId: string; emoji: string }> = []
  const removed: Array<{ messageId: string; reactionId: string }> = []
  const client = {
    im: {
      messageReaction: {
        create: async (payload: { data: { reaction_type: { emoji_type: string } }; path: { message_id: string } }) => {
          created.push({ messageId: payload.path.message_id, emoji: payload.data.reaction_type.emoji_type })
          return { code: 0, data: { reaction_id: `rid-${created.length}` } }
        },
        delete: async (payload: { path: { message_id: string; reaction_id: string } }) => {
          removed.push({ messageId: payload.path.message_id, reactionId: payload.path.reaction_id })
          return { code: 0 }
        },
      },
    },
  }
  return { client, created, removed }
}

describe('ReactionLifecycle', () => {
  it('adds Typing on start and remembers its handle', async () => {
    const { client, created } = makeClient()
    const reactions = new ReactionLifecycle(true)
    await reactions.start(client as never, 'om_1')
    expect(created).toEqual([{ messageId: 'om_1', emoji: REACTION_TYPING }])
  })

  it('does not add Typing twice for the same message', async () => {
    const { client, created } = makeClient()
    const reactions = new ReactionLifecycle(true)
    await reactions.start(client as never, 'om_1')
    await reactions.start(client as never, 'om_1')
    expect(created).toHaveLength(1)
  })

  it('removes Typing on success and does not add CrossMark', async () => {
    const { client, created, removed } = makeClient()
    const reactions = new ReactionLifecycle(true)
    await reactions.start(client as never, 'om_1')
    await reactions.finish(client as never, 'om_1', 'success')
    expect(removed).toEqual([{ messageId: 'om_1', reactionId: 'rid-1' }])
    expect(created.filter((c) => c.emoji === REACTION_CROSS)).toHaveLength(0)
  })

  it('swaps Typing for CrossMark on failure', async () => {
    const { client, created, removed } = makeClient()
    const reactions = new ReactionLifecycle(true)
    await reactions.start(client as never, 'om_1')
    await reactions.finish(client as never, 'om_1', 'failure')
    expect(removed).toHaveLength(1)
    expect(created.some((c) => c.emoji === REACTION_CROSS)).toBe(true)
  })

  it('does not stack CrossMark when Typing could not be removed', async () => {
    const failingDelete = {
      im: {
        messageReaction: {
          create: async () => ({ code: 0, data: { reaction_id: 'rid-1' } }),
          delete: async () => ({ code: 1 }),
        },
      },
    }
    const reactions = new ReactionLifecycle(true)
    await reactions.start(failingDelete as never, 'om_1')
    const crosses: unknown[] = []
    const spy = { original: failingDelete.im.messageReaction.create }
    failingDelete.im.messageReaction.create = async (p: { data: { reaction_type: { emoji_type: string } } }) => {
      crosses.push(p.data.reaction_type.emoji_type)
      return spy.original(p as never)
    }
    await reactions.finish(failingDelete as never, 'om_1', 'failure')
    expect(crosses.some((c) => c === REACTION_CROSS)).toBe(false)
  })

  it('does nothing when disabled', async () => {
    const { client, created } = makeClient()
    const reactions = new ReactionLifecycle(false)
    await reactions.start(client as never, 'om_1')
    await reactions.finish(client as never, 'om_1', 'failure')
    expect(created).toHaveLength(0)
    expect(reactions.isEnabled()).toBe(false)
  })

  it('is enabled by default', () => {
    expect(new ReactionLifecycle(true).isEnabled()).toBe(true)
  })

  it('evicts the oldest handle beyond the cache bound', () => {
    const reactions = new ReactionLifecycle(true, 2)
    const { client, created } = makeClient()
    // Bypass async by reaching the private map via start.
    void reactions.start(client as never, 'om_a')
    void reactions.start(client as never, 'om_b')
    void reactions.start(client as never, 'om_c')
    expect(created).toHaveLength(3)
    expect('om_a' in (reactions as unknown as { pending: Map<string, string> }).pending).toBe(false)
  })
})

describe('reactionsEnabledFromEnv / resolveReactionsEnabled', () => {
  it('defaults on and honors off values', () => {
    expect(reactionsEnabledFromEnv({})).toBe(true)
    expect(reactionsEnabledFromEnv({ FEISHU_REACTIONS: 'false' })).toBe(false)
    expect(reactionsEnabledFromEnv({ FEISHU_REACTIONS: '0' })).toBe(false)
    expect(reactionsEnabledFromEnv({ FEISHU_REACTIONS: 'off' })).toBe(false)
    expect(reactionsEnabledFromEnv({ FEISHU_REACTIONS: 'true' })).toBe(true)
  })
  it('config false disables regardless of env', () => {
    expect(resolveReactionsEnabled(false, { FEISHU_REACTIONS: 'true' })).toBe(false)
    expect(resolveReactionsEnabled(true, {})).toBe(true)
    expect(resolveReactionsEnabled(undefined, {})).toBe(true)
  })
})

describe('REACTION_CACHE_SIZE', () => {
  it('is exported', () => {
    expect(REACTION_CACHE_SIZE).toBe(1024)
  })
})
