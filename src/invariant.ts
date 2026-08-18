/**
 * Package-owned invariant companion for `@aitechmei/dsh-feishu`.
 * @module @aitechmei/dsh-feishu/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@aitechmei/dsh-feishu'

/** Cordis companion plugin name. */
export const name = 'feishu-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a transport. It owns no durable
 * session event stream and mutates no core registry — its contracts are the
 * Lark SDK wire round-trip, access policy, and session binding, which are
 * process-local effects proven by package tests and the durable session
 * invariants owned by `@deepseek-ai/dsh-session` and the agent loop.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */