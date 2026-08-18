import { describe, expect, it } from 'vitest'
import type { ConsoleIO, SelectOption } from '../src/console.ts'
import {
  assertAccessViable,
  parseArgs,
  runSetup,
  type SetupDeps,
} from '../src/setup.ts'
import type { FeishuConfig } from '../src/types.ts'

/** A scripted console that replays queued answers and records questions. */
class ScriptedConsole implements ConsoleIO {
  prompts: string[] = []
  questions: string[] = []
  constructor(private readonly queue: (string | boolean | null)[]) {}
  private next(): string {
    const v = this.queue.shift()
    if (v === null || v === undefined) throw new Error(`No scripted answer left; asked: ${this.questions.at(-1)}`)
    return String(v)
  }
  async prompt(question: string): Promise<string> {
    this.questions.push(question)
    this.prompts.push(question)
    return this.next()
  }
  async select<T>(question: string, options: SelectOption<T>[], defaultValue?: T): Promise<T> {
    this.questions.push(question)
    const v = this.queue.shift()
    if (v === null || v === undefined) {
      if (defaultValue !== undefined) return defaultValue
      throw new Error(`No scripted select left; asked: ${question}`)
    }
    const index = Number(v)
    if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1].value
    return options[0].value
  }
  async yesno(question: string, defaultValue?: boolean): Promise<boolean> {
    this.questions.push(question)
    const v = this.queue.shift()
    if (v === null || v === undefined) return defaultValue ?? false
    return String(v).toLowerCase() === 'y' || String(v).toLowerCase() === 'true' || v === true
  }
}

function fakeDeps(consoleIO: ConsoleIO): SetupDeps {
  const written: Partial<FeishuConfig>[] = []
  return {
    console: consoleIO,
    qrRegister: async () => ({ appId: 'cli_scan', appSecret: 'sec-scan', domain: 'feishu', openId: 'ou_owner' }),
    probeBot: async (appId) => (appId.startsWith('cli_scan') ? { botName: 'Scan Bot' } : { botName: 'Manual Bot' }),
    applyFeishuConfig: async (_profile, config) => { written.push(config) },
    resolveProfileDir: (_name) => '/dsh/profiles/feishu',
    readPatchRows: async () => [],
    getFeishuConfig: () => undefined,
    feishuConfigured: () => false,
    env: { DSH_HOME: '/dsh' },
  } as unknown as SetupDeps & { written?: typeof written }
}

describe('parseArgs', () => {
  it('parses profile, region, and toggles', () => {
    expect(parseArgs(['--profile', 'feishu-test', '--region', 'lark', '--json', '-y'])).toEqual({
      profile: 'feishu-test', region: 'lark', manual: false, dryRun: false, json: true, yes: true,
    })
    expect(parseArgs(['--dry-run', '--manual'])).toMatchObject({ dryRun: true, manual: true })
    expect(parseArgs(['--region=auto']).region).toBe('auto')
    expect(parseArgs([])).toMatchObject({ profile: 'feishu', manual: false })
  })
})

describe('assertAccessViable', () => {
  it('rejects allowlist policies with no subjects', () => {
    expect(() => assertAccessViable({ dmPolicy: 'allowlist', allowFrom: [] })).toThrow(/allowFrom/)
    expect(() => assertAccessViable({ groupPolicy: 'allowlist', groupAllowFrom: [] })).toThrow(/groupAllowFrom/)
  })
  it('accepts open policies or populated allowlists', () => {
    expect(() => assertAccessViable({ dmPolicy: 'open', groupPolicy: 'open' })).not.toThrow()
    expect(() => assertAccessViable({ dmPolicy: 'allowlist', allowFrom: ['ou_x'], groupPolicy: 'allowlist', groupAllowFrom: ['oc_y'] })).not.toThrow()
    expect(() => assertAccessViable({ groupPolicy: 'disabled' })).not.toThrow()
  })
})

describe('runSetup (scan path)', () => {
  it('auto-configures owner allowlist + open group policy and writes config', async () => {
    const io = new ScriptedConsole(['2', '1', '1']) // platform feishu, method scan, dm owner
    const deps = fakeDeps(io)
    const result = await runSetup({ profile: 'feishu', manual: false, dryRun: false, json: false, yes: false }, deps)
    expect(result.ok).toBe(true)
    expect(result.config).toMatchObject({
      appId: 'cli_scan', appSecret: 'sec-scan', domain: 'feishu',
      dmPolicy: 'allowlist', allowFrom: ['ou_owner'], groupPolicy: 'open', requireMention: true,
    })
    expect((deps as unknown as { applyFeishuConfig: (p: string, c: unknown) => void }).applyFeishuConfig).toBeTypeOf('function')
  })
})

describe('runSetup (manual path)', () => {
  it('builds allowlist entries from free-form input', async () => {
    const io = new ScriptedConsole([
      '2',                // platform feishu (manual path, no method select)
      'cli_man', 'sec-man', // appId, appSecret
      '1', 'ou_a, ou_b',  // DM allowlist, allowFrom
      '1', 'oc_x oc_y',   // group allowlist, groupAllowFrom
      'y',                // requireMention
    ])
    const written: Partial<FeishuConfig>[] = []
    const deps = fakeDeps(io)
    deps.applyFeishuConfig = async (_p, c) => { written.push(c) }
    const result = await runSetup({ profile: 'feishu', manual: true, dryRun: false, json: false, yes: false }, deps)
    expect(result.ok).toBe(true)
    expect(result.config).toMatchObject({
      appId: 'cli_man', appSecret: 'sec-man', domain: 'feishu',
      dmPolicy: 'allowlist', allowFrom: ['ou_a', 'ou_b'],
      groupPolicy: 'allowlist', groupAllowFrom: ['oc_x', 'oc_y'], requireMention: true,
    })
    expect(written).toHaveLength(1)
  })

  it('fails when allowlist has empty allowFrom (footgun guard)', async () => {
    const io = new ScriptedConsole(['2', 'cli_m', 'sec', '1', '', '2', 'y'])
    const deps = fakeDeps(io)
    const result = await runSetup({ profile: 'feishu', manual: true, dryRun: false, json: false, yes: false }, deps)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/allowFrom/)
  })
})

describe('runSetup (existing config + dry run)', () => {
  it('skips when reconfigure is declined', async () => {
    const io = new ScriptedConsole(['n'])
    const deps = fakeDeps(io)
    deps.feishuConfigured = () => true
    deps.getFeishuConfig = () => ({ appId: 'cli_old', appSecret: 's' })
    const result = await runSetup({ profile: 'feishu', manual: false, dryRun: false, json: false, yes: false }, deps)
    expect(result).toMatchObject({ ok: true, reconfigured: false, wrote: false })
    expect(result.message).toMatch(/Nothing changed/)
  })

  it('supports dry-run without writing', async () => {
    const io = new ScriptedConsole(['1', '1', '1'])
    const written: Partial<FeishuConfig>[] = []
    const deps = fakeDeps(io)
    deps.applyFeishuConfig = async (_p, c) => { written.push(c) }
    const result = await runSetup({ profile: 'feishu', manual: false, dryRun: true, json: false, yes: true }, deps)
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.wrote).toBe(false)
    expect(written).toHaveLength(0)
  })
})

describe('runSetup (missing profile)', () => {
  it('returns an error with guidance when the profile does not exist', async () => {
    const io = new ScriptedConsole([])
    const deps = fakeDeps(io)
    deps.resolveProfileDir = () => { throw new Error('dsh profile "nope" not found') }
    const result = await runSetup({ profile: 'nope', manual: true, dryRun: false, json: false, yes: false }, deps)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/create it first/)
  })
})
