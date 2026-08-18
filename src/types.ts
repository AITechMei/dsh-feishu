/**
 * Feishu bot plugin types: config, source tags, and parsed inbound facts.
 * @module @aitechmei/dsh-feishu
 */

// Side-effect type import: declaration-merges the Feishu message source tag.
import type {} from '@deepseek-ai/dsh-llm'

/** Feishu open-platform domain: domestic Feishu or international Lark. */
export type FeishuDomain = 'feishu' | 'lark'

/** Direct-message admission policy. */
export type FeishuDmPolicy = 'allowlist' | 'open'

/** Group-chat admission policy. */
export type FeishuGroupPolicy = 'allowlist' | 'disabled' | 'open'

/** Plugin configuration, validated by the schema in {@link FeishuConfig}. */
export interface FeishuConfig {
  /** Feishu open-platform app id (from the app's credentials page). */
  appId: string
  /** Feishu open-platform app secret. */
  appSecret: string
  /** Event subscription verification token; optional when not configured on the app. */
  verificationToken?: string
  /** Event subscription encryption key; used when the app encrypts event payloads. */
  encryptKey?: string
  /** Open-platform domain; `feishu` (default) or `lark`. */
  domain?: FeishuDomain
  /** Who may direct-message the bot. `allowlist` (default) admits only `allowFrom`. */
  dmPolicy?: FeishuDmPolicy
  /** Open ids (`ou_…`) admitted to direct-message the bot under `dmPolicy: allowlist`. */
  allowFrom?: string[]
  /** Group-chat admission policy: `allowlist` (default), `disabled`, or `open`. */
  groupPolicy?: FeishuGroupPolicy
  /** Chat ids (`oc_…`) whose groups admit the bot under `groupPolicy: allowlist`. */
  groupAllowFrom?: string[]
  /** Require an @mention to trigger the bot in groups. Defaults to true. */
  requireMention?: boolean
  /** Provider route for created agents; absent uses the deployment default. */
  provider?: string
  /** Model id for created agents; absent uses the deployment default. */
  model?: string
  /** Working directory for created sessions; absent uses the host cwd. */
  cwd?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * A user message admitted through the Feishu channel. The durable
     * transcript carries the originating chat and sender so the model and any
     * consumer can attribute the prompt without depending on live transport.
     */
    feishu: {
      kind: 'feishu'
      /** Feishu chat id (`oc_…` for groups, a p2p chat id for direct messages). */
      chatId: string
      /** Sender open id (`ou_…`). */
      senderOpenId: string
      /** Feishu message id that carried the prompt. */
      messageId: string
    }
  }
}

/** A direct-message inbound fact, used to route a prompt to a session. */
export interface FeishuDirectMessage {
  readonly kind: 'dm'
  readonly chatId: string
  readonly senderOpenId: string
  readonly messageId: string
  readonly text: string
}

/** A group-chat inbound fact, mention-gated. */
export interface FeishuGroupMessage {
  readonly kind: 'group'
  readonly chatId: string
  readonly senderOpenId: string
  readonly messageId: string
  readonly text: string
}

/** The subset of inbound facts the bot may admit to a session. */
export type FeishuInboundMessage = FeishuDirectMessage | FeishuGroupMessage