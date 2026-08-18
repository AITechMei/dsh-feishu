/**
 * Feishu / Lark device-code onboarding: the official (reverse-engineered)
 * flow used by hermes to auto-create a PersonalAgent app from a phone scan.
 * Wraps init -> begin -> poll -> probe, reusing the runtime Feishu client for
 * the credential probe. Best-effort: manual entry remains the durable path.
 * @module @aitechmei/dsh-feishu
 */

export type OnboardRegion = 'feishu' | 'lark'

import { createFeishuClient } from './client.ts'

/** Minimal shape of the Feishu client used by the credential probe. */
export interface BotProbeClient {
  request: (payload: { method: string; url: string }) => Promise<unknown>
}

/** Accounts base URLs for the device-code registration endpoint. */
export const ACCOUNTS_BASE_URLS: Record<OnboardRegion, string> = {
  feishu: 'https://accounts.feishu.cn',
  lark: 'https://accounts.larksuite.com',
}

/** Open-platform base URLs (used only when rendering fallback links). */
export const OPENPLATFORM_URLS: Record<OnboardRegion, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
}

/** The device-code registration endpoint. */
export const REGISTRATION_PATH = '/oauth/v1/app/registration'

/** Successful registration result after polling. */
export interface OnboardResult {
  appId: string
  appSecret: string
  domain: OnboardRegion
  openId?: string
  botName?: string
  botOpenId?: string
}

/** Request-parameter types for the raw registration calls. */
export interface BeginResult {
  deviceCode: string
  qrUrl: string
  userCode: string
  interval: number
  expireIn: number
}

/**
 * Verify the environment supports `client_secret` auth. Throws when unsupported.
 * @param fetchImpl - injectable fetch-compatible function (for tests).
 */
export async function regInit(
  region: OnboardRegion,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  throw new Error('Not implemented: M2')
}

/**
 * Start the device-code flow, returning a QR URL to scan plus poll metadata.
 */
export async function regBegin(
  region: OnboardRegion,
  fetchImpl: typeof fetch = fetch,
): Promise<BeginResult> {
  throw new Error('Not implemented: M2')
}

/**
 * Poll until the user scans the QR (credentials) or a terminal state / timeout.
 * On `lark` tenant detection the domain auto-switches; the returned result
 * carries the final domain.
 */
export async function regPoll(
  options: {
    deviceCode: string
    interval: number
    expireIn: number
    initialRegion: OnboardRegion
    clock?: () => number
    sleep?: (ms: number) => Promise<void>
    fetchImpl?: typeof fetch
  },
): Promise<OnboardResult | undefined> {
  throw new Error('Not implemented: M2')
}

/** Render a QR code for the given URL in a terminal; false when unsupported. */
export function renderQr(url: string): boolean {
  throw new Error('Not implemented: M2')
}

/**
 * Verify credentials are usable by calling `GET /open-apis/bot/v3/info` through
 * the runtime Feishu client (identical domain/auth to the running channel, so
 * a QR auto-detected `lark` domain stays in sync with the probe). Resolves the
 * bot's name and open id when reachable, else undefined.
 * @param createClient - injectable client factory (defaults to createFeishuClient).
 */
export async function probeBot(
  appId: string,
  appSecret: string,
  domain: OnboardRegion,
  createClient: (config: { appId: string; appSecret: string; domain: OnboardRegion }) => BotProbeClient = createFeishuClient,
): Promise<{ botName?: string; botOpenId?: string } | undefined> {
  throw new Error('Not implemented: M2')
}

/**
 * Run init -> begin -> poll -> probe and return the onboarded account, or
 * undefined on expected failures (network, denial, timeout).
 */
export async function qrRegister(
  options: { initialRegion?: OnboardRegion; timeoutSeconds?: number } = {},
): Promise<OnboardResult | undefined> {
  throw new Error('Not implemented: M2')
}
