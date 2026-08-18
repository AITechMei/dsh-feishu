/**
 * Interactive setup wizard: guides a user through scanning (device-code) or
 * manual credential entry, access-policy guidance, and persists the feishu
 * row into the profile's `cordis.patch.yml`. IO is injected so the wizard can
 * be driven by a scripted fake console in tests.
 * @module @aitechmei/dsh-feishu
 */

import { createConsole, type ConsoleIO, type SelectOption } from './console.ts'
import {
  qrRegister,
  probeBot,
  type OnboardRegion,
} from './onboarding.ts'
import YAML from 'yaml'
import {
  applyFeishuConfig,
  resolveProfileDir,
  readPatchRows,
  getFeishuConfig,
  feishuConfigured,
  upsertFeishuRow,
  type ProfileEnv,
} from './profile-config.ts'
import type { FeishuConfig } from './types.ts'
import { createFeishuClient } from './client.ts'

/** Parsed CLI options for the setup command. */
export interface SetupOptions {
  profile: string
  region?: 'feishu' | 'lark' | 'auto'
  manual: boolean
  dryRun: boolean
  json: boolean
  yes: boolean
}

/** The dependency surface the wizard uses; swap in fakes for tests. */
export interface SetupDeps {
  console: ConsoleIO
  qrRegister: typeof qrRegister
  probeBot: typeof probeBot
  applyFeishuConfig: typeof applyFeishuConfig
  resolveProfileDir: typeof resolveProfileDir
  readPatchRows: typeof readPatchRows
  getFeishuConfig: typeof getFeishuConfig
  feishuConfigured: typeof feishuConfigured
  env: ProfileEnv
}

/** Real wiring used by the CLI entry point. */
export function defaultDeps(): SetupDeps {
  return {
    console: createConsole(),
    qrRegister,
    probeBot,
    applyFeishuConfig,
    resolveProfileDir,
    readPatchRows,
    getFeishuConfig,
    feishuConfigured,
    env: process.env,
  }
}

/** The result returned by the wizard (and printed as JSON with --json). */
export interface SetupResult {
  ok: boolean
  reconfigured: boolean
  wrote: boolean
  dryRun: boolean
  profile: string
  config?: Partial<FeishuConfig>
  message?: string
  error?: string
}

/** Parse the CLI argv into {@link SetupOptions}. Unknown flags are ignored. */
export function parseArgs(argv: string[]): SetupOptions {
  const options: SetupOptions = {
    profile: 'feishu',
    manual: false,
    dryRun: false,
    json: false,
    yes: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = (flag: string): string | undefined => {
      if (arg === flag) return argv[++i]
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
      return undefined
    }
    if (arg === '--profile' || arg.startsWith('--profile=')) {
      const v = value('--profile')
      if (v !== undefined && v.length > 0) options.profile = v
    } else if (arg === '--region' || arg.startsWith('--region=')) {
      const v = value('--region')
      if (v === 'feishu' || v === 'lark' || v === 'auto') options.region = v
    } else if (arg === '--manual' || arg === '-m') {
      options.manual = true
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true
    }
  }
  return options
}

const PLATFORM_OPTIONS: SelectOption<OnboardRegion | 'auto'>[] = [
  { label: 'Scan QR — auto-detect Feishu/Lark (recommended)', value: 'auto' },
  { label: 'Feishu (accounts.feishu.cn)', value: 'feishu' },
  { label: 'Lark international (accounts.larksuite.com)', value: 'lark' },
]

const METHOD_OPTIONS: SelectOption<'scan' | 'manual'>[] = [
  { label: 'Scan QR to auto-create the bot (recommended)', value: 'scan' },
  { label: 'Enter appId / appSecret manually', value: 'manual' },
]

/** Guard against the allowlist-with-no-subjects footgun (P0/P1-5). */
export function assertAccessViable(config: Partial<FeishuConfig>): void {
  if (config.dmPolicy === 'allowlist' && (config.allowFrom?.length ?? 0) === 0) {
    throw new Error('dmPolicy "allowlist" requires at least one sender in allowFrom (or choose dmPolicy "open")')
  }
  if (config.groupPolicy === 'allowlist' && (config.groupAllowFrom?.length ?? 0) === 0) {
    throw new Error('groupPolicy "allowlist" requires at least one group in groupAllowFrom (or choose "open"/"disabled")')
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** Run the wizard end-to-end. */
export async function runSetup(options: SetupOptions, deps: SetupDeps): Promise<SetupResult> {
  const { console: io } = deps
  const fail = (error: string): SetupResult => ({ ok: false, reconfigured: false, wrote: false, dryRun: options.dryRun, profile: options.profile, error })

  let profileDir: string
  try {
    profileDir = deps.resolveProfileDir(options.profile, { env: deps.env })
  } catch (error) {
    const message = `${String(error)} Use \`dsh plugin --profile ${options.profile}\` to create it first.`
    return fail(message)
  }

  let rows: unknown[]
  try {
    rows = await deps.readPatchRows(profileDir)
  } catch (error) {
    return fail(`Failed to read ${options.profile} patch: ${String(error)}`)
  }

  const existingFeishu = deps.getFeishuConfig(rows)
  const already = deps.feishuConfigured(existingFeishu)
  if (already && !options.yes) {
    const proceed = await io.yesno(`feishu is already configured (appId ${existingFeishu!.appId}). Reconfigure?`, false)
    if (!proceed) {
      return { ok: true, reconfigured: false, wrote: false, dryRun: options.dryRun, profile: options.profile, message: 'Nothing changed.' }
    }
  }
  const reconfigured = already

  // ---- platform & method -------------------------------------------------
  const rawRegion = options.region ?? await io.select('Feishu or Lark?', PLATFORM_OPTIONS, 'auto')
  const initialRegion: OnboardRegion = rawRegion === 'auto' ? 'feishu' : rawRegion
  const method = options.manual ? 'manual' : await io.select('How would you like to connect?', METHOD_OPTIONS, 'scan')

  // ---- credentials --------------------------------------------------------
  let appId = ''
  let appSecret = ''
  let domain: OnboardRegion = rawRegion === 'auto' ? 'feishu' : rawRegion
  let ownerOpenId: string | undefined
  let botName: string | undefined

  if (method === 'scan') {
    const scanned = await deps.qrRegister({ initialRegion, timeoutSeconds: 600 })
    if (scanned !== undefined) {
      appId = scanned.appId
      appSecret = scanned.appSecret
      domain = scanned.domain
      ownerOpenId = scanned.openId
      botName = scanned.botName
    }
  }

  if (method === 'manual' || appId === '') {
    if (method === 'scan' && appId === '') {
      const proceed = await io.yesno('QR registration is unavailable (best-effort feature). Continue with manual entry?', true)
      if (!proceed) {
        return { ok: true, reconfigured, wrote: false, dryRun: options.dryRun, profile: options.profile, message: 'Setup cancelled after QR registration was unavailable.' }
      }
    }
    appId = await io.prompt('Feishu appId (e.g. cli_xxx): ')
    appSecret = await io.prompt('Feishu appSecret: ')
    if (rawRegion === 'auto') {
      domain = await io.select('Feishu or Lark domain?', PLATFORM_OPTIONS.slice(1) as SelectOption<OnboardRegion>[], 'feishu')
    } else {
      domain = rawRegion
    }
  }

  if (appId === '' || appSecret === '') {
    return fail('appId and appSecret are required')
  }

  // ---- probe (best-effort) ------------------------------------------------
  const probe = await deps.probeBot(appId, appSecret, domain, createFeishuClient)
  if (probe !== undefined) {
    botName = probe.botName
  }

  // ---- access policy ------------------------------------------------------
  const config: Partial<FeishuConfig> = { appId, appSecret, domain }

  if (method === 'scan' && ownerOpenId !== undefined) {
    const dm = await io.select(
      'Who may directly message the bot (DMs)?',
      [
        { label: `Only me (${ownerOpenId})`, value: 'owner' },
        { label: 'Anyone (open)', value: 'open' },
      ],
      options.yes ? 'owner' : undefined,
    )
    if (dm === 'owner') {
      config.dmPolicy = 'allowlist'
      config.allowFrom = [ownerOpenId]
    } else {
      config.dmPolicy = 'open'
    }
    // Scan-created bots work out of the box in groups via @mentions.
    config.groupPolicy = 'open'
    config.requireMention = true
  } else {
    const dm = await io.select(
      'Who may directly message the bot (DMs)?',
      [
        { label: 'Allowlist (enter senders)', value: 'allowlist' },
        { label: 'Anyone (open)', value: 'open' },
      ],
      'allowlist',
    )
    if (dm === 'allowlist') {
      const raw = await io.prompt('DM allowFrom open ids (comma/space separated): ')
      config.dmPolicy = 'allowlist'
      config.allowFrom = splitList(raw)
    } else {
      config.dmPolicy = 'open'
    }

    const group = await io.select(
      'Group chat policy?',
      [
        { label: 'Allowlist (enter groups)', value: 'allowlist' },
        { label: 'Open (any group)', value: 'open' },
        { label: 'Disabled', value: 'disabled' },
      ],
      'allowlist',
    )
    if (group === 'allowlist') {
      const raw = await io.prompt('groupAllowFrom chat ids (oc_..., comma/space separated): ')
      config.groupPolicy = 'allowlist'
      config.groupAllowFrom = splitList(raw)
    } else if (group === 'open') {
      config.groupPolicy = 'open'
    } else {
      config.groupPolicy = 'disabled'
    }
    config.requireMention = await io.yesno('Require an @mention to trigger the bot in groups?', true)
  }

  try {
    assertAccessViable(config)
  } catch (error) {
    return fail(String(error))
  }

  // ---- persist ------------------------------------------------------------
  if (!options.dryRun) {
    try {
      await deps.applyFeishuConfig(options.profile, config, { env: deps.env })
    } catch (error) {
      return fail(`Failed to write ${options.profile} config: ${String(error)}`)
    }
  }

  let message: string
  if (options.dryRun) {
    const pendingRows = structuredClone(rows)
    upsertFeishuRow(pendingRows, config)
    const patch = YAML.stringify(pendingRows)
    message = `(dry run) Would write the following to ${profileDir}/cordis.patch.yml:\n\n${patch}\nRestart dsh to pick up changes.`
  } else {
    message = `Configured. Restart dsh to load the feishu bot (e.g. \`dsh --profile ${options.profile}\`).`
  }
  return {
    ok: true,
    reconfigured,
    wrote: !options.dryRun,
    dryRun: options.dryRun,
    profile: options.profile,
    config,
    message,
  }
}

/** CLI entry: parse args, run with real deps, print result, set exit code. */
export async function main(argv: string[]): Promise<SetupResult> {
  const options = parseArgs(argv)
  const result = await runSetup(options, defaultDeps())
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    if (!result.ok && result.error !== undefined) {
      process.stderr.write(`Error: ${result.error}\n`)
    }
    if (result.message !== undefined) {
      process.stdout.write(result.message + '\n')
    }
  }
  if (!result.ok) process.exitCode = 1
  return result
}
