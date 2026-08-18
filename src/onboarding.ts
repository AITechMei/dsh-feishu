/**
 * Feishu / Lark device-code onboarding: the official (reverse-engineered)
 * flow to auto-create a PersonalAgent app from a phone scan. Wraps
 * init -> begin -> poll -> probe, reusing the runtime Feishu client for the
 * credential probe. Best-effort: manual entry remains the durable path.
 * @module @aitechmei/dsh-feishu
 */

import qrcode from 'qrcode'
import { createFeishuClient } from './client.ts'

export type OnboardRegion = 'feishu' | 'lark'

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

/** URL query appended to the scan URL to attribute the flow (`tp`/`from`). */
export const SCAN_URL_ATTRIBUTION = 'from=dsh-feishu&tp=dsh-feishu'

/** Successful registration result after polling. */
export interface OnboardResult {
  appId: string
  appSecret: string
  domain: OnboardRegion
  openId?: string
  botName?: string
  botOpenId?: string
}

/** Values returned by the `begin` call needed to drive polling. */
export interface BeginResult {
  deviceCode: string
  qrUrl: string
  userCode: string
  interval: number
  expireIn: number
}

/** Minimal shape of the Feishu client used by the credential probe. */
export interface BotProbeClient {
  request: (payload: { method: string; url: string }) => Promise<unknown>
}

/** The response shape a fetch-like must satisfy for the registration calls. */
export interface FetchResponse {
  status: number
  json: () => Promise<unknown>
}

/** A fetch-compatible function usable for the registration endpoint. */
export type FetchImpl = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>

/** Production fetch wrapper mapping to the smaller response contract. */
export async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<FetchResponse> {
  const response = await fetch(url, init as RequestInit)
  return { status: response.status, json: () => response.json() }
}

function accountsBaseUrl(region: OnboardRegion): string {
  return ACCOUNTS_BASE_URLS[region]
}

/** POST form-encoded data to the registration endpoint and parse JSON.
 *  The endpoint returns JSON even on 4xx (poll yields `authorization_pending`
 *  as a 400), so the HTTP status is not a failure signal by itself. */
async function postRegistration(
  options: { region: OnboardRegion; body: Record<string, string> },
  fetchImpl: FetchImpl,
): Promise<Record<string, unknown>> {
  const url = `${accountsBaseUrl(options.region)}${REGISTRATION_PATH}`
  const body = new URLSearchParams(options.body).toString()
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return (await response.json()) as Record<string, unknown>
}

/**
 * Verify the environment supports `client_secret` auth. Throws when unsupported.
 * @param region - feishu or lark.
 * @param fetchImpl - injectable fetch-compatible function (for tests).
 */
export async function regInit(
  region: OnboardRegion = 'feishu',
  fetchImpl: FetchImpl = defaultFetch,
): Promise<void> {
  const response = await postRegistration({ region, body: { action: 'init' } }, fetchImpl)
  const methods = response.supported_auth_methods
  if (!Array.isArray(methods) || !methods.includes('client_secret')) {
    throw new Error(
      `Feishu / Lark registration environment does not support client_secret auth. Supported: ${JSON.stringify(methods)}`,
    )
  }
}

/**
 * Start the device-code flow, returning a scan URL plus poll metadata.
 * @param region - feishu or lark.
 * @param fetchImpl - injectable fetch-compatible function (for tests).
 */
export async function regBegin(
  region: OnboardRegion = 'feishu',
  fetchImpl: FetchImpl = defaultFetch,
): Promise<BeginResult> {
  const response = await postRegistration(
    {
      region,
      body: {
        action: 'begin',
        archetype: 'PersonalAgent',
        auth_method: 'client_secret',
        request_user_info: 'open_id',
      },
    },
    fetchImpl,
  )
  const deviceCode = response.device_code
  if (typeof deviceCode !== 'string' || deviceCode.length === 0) {
    throw new Error('Feishu / Lark registration did not return a device_code')
  }
  const rawUrl = typeof response.verification_uri_complete === 'string'
    ? response.verification_uri_complete
    : ''
  if (rawUrl.length === 0) {
    throw new Error('Feishu / Lark registration did not return a verification_uri_complete')
  }
  const qrUrl = rawUrl + (rawUrl.includes('?') ? '&' : '?') + SCAN_URL_ATTRIBUTION
  return {
    deviceCode,
    qrUrl,
    userCode: typeof response.user_code === 'string' ? response.user_code : '',
    interval: typeof response.interval === 'number' ? response.interval : 5,
    expireIn: typeof response.expire_in === 'number' ? response.expire_in : 600,
  }
}

/**
 * Poll until the user scans the QR (credentials) or a terminal state / timeout.
 * On `lark` tenant detection the domain auto-switches; the returned result
 * carries the final domain.
 */
export async function regPoll(options: {
  deviceCode: string
  interval: number
  expireIn: number
  initialRegion?: OnboardRegion
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: FetchImpl
}): Promise<OnboardResult | undefined> {
  const {
    deviceCode,
    interval,
    expireIn,
    initialRegion = 'feishu',
    clock = Date.now,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchImpl = defaultFetch,
  } = options
  const deadline = clock() + expireIn * 1000
  let currentRegion = initialRegion
  let domainSwitched = false

  while (clock() < deadline) {
    const response = await postRegistration(
      { region: currentRegion, body: { action: 'poll', device_code: deviceCode, tp: 'ob_app' } },
      fetchImpl,
    )

    // Domain auto-detection: the server may switch feishu/lark mid-flow.
    const userInfo = (response.user_info ?? {}) as Record<string, unknown>
    const tenantBrand = userInfo.tenant_brand
    if (tenantBrand === 'lark' && !domainSwitched) {
      currentRegion = 'lark'
      domainSwitched = true
      // Fall through — the server may return credentials in the same response.
    }

    // Success: credentials must be non-empty strings.
    if (
      typeof response.client_id === 'string' && response.client_id.length > 0
      && typeof response.client_secret === 'string' && response.client_secret.length > 0
    ) {
      return {
        appId: response.client_id,
        appSecret: response.client_secret,
        domain: currentRegion,
        openId: typeof userInfo.open_id === 'string' ? userInfo.open_id : undefined,
      }
    }

    // Terminal errors.
    const error = response.error
    if (error === 'access_denied' || error === 'expired_token') {
      return undefined
    }

    // authorization_pending or unknown — keep polling.
    await sleep(Math.max(0, interval) * 1000)
  }
  return undefined
}

/**
 * Render a QR code for the given URL in the terminal, writing it to stdout.
 * Returns true on success; false when rendering is unsupported (so the caller
 * falls back to printing the URL).
 */
export async function renderQr(url: string): Promise<boolean> {
  try {
    const output = await qrcode.toString(url, { type: 'terminal', small: true })
    process.stdout.write(output + '\n')
    return true
  } catch {
    return false
  }
}

/** Info returned by the credential probe (`GET /open-apis/bot/v3/info`). */
export interface ProbeResult {
  botName?: string
  botOpenId?: string
}

/**
 * Verify credentials are usable by calling `GET /open-apis/bot/v3/info`
 * through the runtime Feishu client (identical domain/auth to the running
 * channel, so a QR auto-detected `lark` domain stays in sync with the probe).
 * @param createClient - injectable client factory (defaults to createFeishuClient).
 */
export async function probeBot(
  appId: string,
  appSecret: string,
  region: OnboardRegion,
  createClient: (
    config: { appId: string; appSecret: string; domain: OnboardRegion },
  ) => BotProbeClient = createFeishuClient,
): Promise<ProbeResult | undefined> {
  try {
    const client = createClient({ appId, appSecret, domain: region })
    const response = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' }) as {
      code?: number
      bot?: { app_name?: string; bot_name?: string; open_id?: string }
    }
    if (response.code !== undefined && response.code !== 0) return undefined
    const bot = response.bot
    if (bot === undefined) return undefined
    return {
      botName: bot.app_name ?? bot.bot_name,
      botOpenId: bot.open_id,
    }
  } catch {
    return undefined
  }
}

/**
 * Run init -> begin -> poll -> probe and return the onboarded account, or
 * undefined on expected failures (network, denial, timeout). Prints the scan
 * URL and, when a terminal QR renderer is available, an ASCII QR code.
 */
export async function qrRegister(options: {
  initialRegion?: OnboardRegion
  timeoutSeconds?: number
  fetchImpl?: FetchImpl
  renderQrImpl?: (url: string) => Promise<boolean>
  print?: (line: string) => void
} = {}): Promise<OnboardResult | undefined> {
  const {
    initialRegion = 'feishu',
    timeoutSeconds = 600,
    fetchImpl = defaultFetch,
    renderQrImpl = renderQr,
    print = (line) => process.stdout.write(line + '\n'),
  } = options

  print('  Connecting to Feishu / Lark...')
  try {
    await regInit(initialRegion, fetchImpl)
    const begin = await regBegin(initialRegion, fetchImpl)
    print(' done.')

    print(`\n  Scan the QR code below, or open this URL directly:\n  ${begin.qrUrl}`)
    if ((await renderQrImpl(begin.qrUrl)) !== true) {
      print('  (No terminal QR render — open the URL above in the Feishu/Lark app.)')
    }
    print('')

    const result = await regPoll({
      deviceCode: begin.deviceCode,
      interval: begin.interval,
      expireIn: Math.min(begin.expireIn, timeoutSeconds),
      initialRegion,
      fetchImpl,
    })
    if (result === undefined) return undefined

    const probe = await probeBot(result.appId, result.appSecret, result.domain)
    return {
      ...result,
      ...(probe === undefined ? {} : { botName: probe.botName, botOpenId: probe.botOpenId }),
    }
  } catch (error) {
    // Scan-to-create is best-effort: any network/protocol hiccup must degrade
    // gracefully to manual entry rather than kill the whole wizard.
    print(`  Registration failed (${String(error)}). Falling back to manual entry.`)
    return undefined
  }
}
