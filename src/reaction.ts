/**
 * "Thinking" reaction lifecycle: adds a `Typing` reaction to the inbound
 * message while an agent works, removes it on completion, and swaps in a
 * `CrossMark` when the turn fails. Reactions render as prominent badges (a
 * borrowed static emoji token), so only start + failure are marked — the reply
 * itself is the success signal.
 * @module @aitechmei/dsh-feishu
 */

import {
  REACTION_CROSS,
  REACTION_TYPING,
  addMessageReaction,
  removeMessageReaction,
  type FeishuClient,
} from './client.ts'

/** Environment variable that can disable reactions globally. */
export const FEISHU_REACTIONS_ENV = 'FEISHU_REACTIONS'

/** LRU cap on the message_id -> reaction_id handle cache. */
export const REACTION_CACHE_SIZE = 1024

/** The lifecycle outcome of a turn: completed or failed. */
export type ReactionOutcome = 'success' | 'failure'

/**
 * Decide whether reactions are active from the environment. The feature is on
 * unless the env var is set to an explicit off value.
 */
export function reactionsEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[FEISHU_REACTIONS_ENV] ?? 'true').trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(value)
}

/** Combine the config switch and the environment gate into a final setting. */
export function resolveReactionsEnabled(configReactions: boolean | undefined, env = process.env): boolean {
  if (configReactions === false) return false
  return reactionsEnabledFromEnv(env)
}

/** Owns the message_id -> reaction_id handle cache and the start/finish flow. */
export class ReactionLifecycle {
  private readonly pending = new Map<string, string>()

  /**
   * @param enabled - whether reactions are active (config+env resolved).
   * @param cacheSize - LRU bound on tracking handles.
   */
  constructor(
    private readonly enabled: boolean,
    private readonly cacheSize: number = REACTION_CACHE_SIZE,
  ) {}

  /** Whether this lifecycle performs any work. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Add the `Typing` reaction on an inbound message and remember its handle. */
  async start(client: FeishuClient, messageId: string): Promise<void> {
    if (!this.enabled || messageId.length === 0 || this.pending.has(messageId)) return
    const reactionId = await addMessageReaction(client, messageId, REACTION_TYPING)
    if (reactionId !== undefined) this.remember(messageId, reactionId)
  }

  /**
   * Remove `Typing`; on failure also add `CrossMark`. If the starting reaction
   * could not be removed, do not stack a second badge.
   */
  async finish(client: FeishuClient, messageId: string, outcome: ReactionOutcome): Promise<void> {
    if (!this.enabled || messageId.length === 0) return
    const startReactionId = this.pending.get(messageId)
    if (startReactionId !== undefined) {
      const removed = await removeMessageReaction(client, messageId, startReactionId)
      this.pending.delete(messageId)
      if (!removed) return
    }
    if (outcome === 'failure') {
      await addMessageReaction(client, messageId, REACTION_CROSS)
    }
  }

  private remember(messageId: string, reactionId: string): void {
    this.pending.set(messageId, reactionId)
    while (this.pending.size > this.cacheSize) {
      const oldest = this.pending.keys().next().value
      if (oldest === undefined) break
      this.pending.delete(oldest)
    }
  }
}
