/**
 * Per-chat agent resolution: one durable session per Feishu chat, keyed
 * deterministically from the chat id so a conversation's history survives a
 * process restart and a live agent is reused across messages.
 * @module @aitechmei/dsh-feishu
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionId as SessionIdBrand } from '@deepseek-ai/dsh-session'

/** Session-id prefix owned by this channel; ids under it map back to a chat. */
export const FEISHU_SESSION_PREFIX = 'feishu:'

/** Derive the deterministic session id for one Feishu chat. */
export function feishuSessionId(chatId: string): SessionIdBrand {
  return SessionId(`${FEISHU_SESSION_PREFIX}${chatId}`)
}

/** Recover the chat id from a channel-owned session id, or undefined. */
export function chatIdFromSession(sessionId: SessionIdBrand): string | undefined {
  return sessionId.startsWith(FEISHU_SESSION_PREFIX)
    ? sessionId.slice(FEISHU_SESSION_PREFIX.length)
    : undefined
}

/** Options for creating/resuming a per-chat agent. */
export interface ChatSessionOptions {
  /** Provider route for created agents; omitted uses the deployment default. */
  provider?: string
  /** Model id for created agents; omitted uses the deployment default. */
  model?: string
  /** Working directory for created sessions; omitted uses the host cwd. */
  cwd?: string
  /** Resolve the deployment default model selection when provider/model are unset. */
  resolveDefaultModel?: () => ModelSelection | undefined
}

/**
 * Owns the lifecycle of one agent per Feishu chat. Resolution deduplicates
 * concurrent requests for the same chat and records every served session id
 * so the reply relay can filter the session event stream.
 */
export class ChatSessions {
  private readonly inflight = new Map<SessionIdBrand, Promise<Agent>>()
  private readonly serving = new Set<SessionIdBrand>()

  /**
   * @param ctx - Cordis context carrying the agent registry.
   * @param options - per-agent defaults used when a chat's agent is created.
   */
  constructor(
    private readonly ctx: Context,
    private readonly options: ChatSessionOptions,
  ) {}

  /** Whether a session id belongs to this channel and is currently served. */
  isServing(sessionId: SessionIdBrand): boolean {
    return this.serving.has(sessionId)
  }

  /** Resolve the live agent for a chat, resuming or creating it as needed. */
  async agentFor(chatId: string): Promise<Agent> {
    const sessionId = feishuSessionId(chatId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const pending = this.inflight.get(sessionId)
    if (pending !== undefined) return pending
    const agent = this.open(sessionId)
    this.inflight.set(sessionId, agent)
    try {
      return await agent
    } finally {
      this.inflight.delete(sessionId)
    }
  }

  private async open(sessionId: SessionIdBrand): Promise<Agent> {
    // Resolve the model route: an explicit per-config choice wins, otherwise the
    // deployment default selection (when one is configured) applies, matching the
    // headless bundle's agent-creation contract.
    const provider = this.options.provider ?? this.options.resolveDefaultModel?.()?.provider
    const model = this.options.model ?? this.options.resolveDefaultModel?.()?.model
    const selection: ModelSelection | undefined = provider !== undefined && model !== undefined
      ? { provider, model }
      : undefined
    const agentOptions: AgentOptions = {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    }
    const setup = selection === undefined
      ? undefined
      : (agentCtx: Context): void => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      }
    const meta = { cwd: this.options.cwd ?? process.cwd() }
    const setupOption = setup === undefined ? {} : { setup }
    try {
      const handle = await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        ...setupOption,
      })
      this.serving.add(sessionId)
      return handle.agent
    } catch {
      // Not persisted (or persistence is absent): create a fresh session for
      // this chat. A failed resume is atomic and never publishes a partial
      // agent, so falling through to create cannot collide with a live entry.
      const handle = await this.ctx.agents.create({
        sessionId,
        meta,
        agentOptions,
        ...setupOption,
      })
      this.serving.add(sessionId)
      return handle.agent
    }
  }
}