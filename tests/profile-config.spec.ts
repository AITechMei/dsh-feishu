import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  PATCH_FILENAME,
  applyFeishuConfig,
  feishuConfigured,
  findRowById,
  getFeishuConfig,
  readPatchRows,
  resolveDshHome,
  resolveProfileDir,
  upsertFeishuRow,
  writePatchRows,
} from '../src/profile-config.ts'

async function tempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feishu-test-'))
}

describe('resolveDshHome', () => {
  it('prefers DSH_HOME when set', () => {
    expect(resolveDshHome({ DSH_HOME: '/custom/dsh', HOME: '/home/x' })).toBe('/custom/dsh')
  })
  it('defaults to HOME/.dsh', () => {
    expect(resolveDshHome({ HOME: '/home/x' })).toBe('/home/x/.dsh')
  })
})

describe('resolveProfileDir', () => {
  it('resolves under profiles/<name> when create is requested', () => {
    expect(resolveProfileDir('feishu', { env: { DSH_HOME: '/dsh' }, create: true }))
      .toBe('/dsh/profiles/feishu')
  })
  it('throws when the profile is not expected to exist (no create)', () => {
    expect(() => resolveProfileDir('nope', { env: { HOME: '/x' } })).toThrow(/not found/)
  })
  it('does not throw when create is requested', () => {
    expect(resolveProfileDir('nope', { env: { HOME: '/x' }, create: true })).toBe('/x/.dsh/profiles/nope')
  })
})

describe('findRowById', () => {
  it('finds a flat row', () => {
    const rows: unknown[] = [{ id: 'a' }, { id: 'feishu', config: {} }]
    const found = findRowById(rows, 'feishu')
    expect(found?.index).toBe(1)
    expect(found?.array).toBe(rows)
  })
  it('descends into insert blocks', () => {
    const rows: unknown[] = [{ insert: [{ id: 'feishu', config: {} }] }]
    const found = findRowById(rows, 'feishu')
    expect(found?.index).toBe(0)
    expect((found?.array[found!.index] as { id: string }).id).toBe('feishu')
  })
  it('returns undefined when absent', () => {
    expect(findRowById([{ id: 'a' }], 'feishu')).toBeUndefined()
  })
})

describe('feishuConfigured', () => {
  it('true only when both credentials are non-empty', () => {
    expect(feishuConfigured({ appId: 'a', appSecret: 's' })).toBe(true)
    expect(feishuConfigured({ appId: 'a' })).toBe(false)
    expect(feishuConfigured({ appId: '', appSecret: 's' })).toBe(false)
    expect(feishuConfigured(undefined)).toBe(false)
  })
})

describe('upsertFeishuRow / getFeishuConfig', () => {
  it('merges into an existing row without dropping unrelated keys', () => {
    const rows: unknown[] = [{ id: 'feishu', config: { appId: 'existing', provider: 'p' } }, { id: 'other' }]
    const updated = upsertFeishuRow(rows, { appSecret: 's', domain: 'feishu' })
    expect(updated).toBe(true)
    expect(getFeishuConfig(rows)).toEqual({ appId: 'existing', provider: 'p', appSecret: 's', domain: 'feishu' })
    expect((rows[1] as { id: string }).id).toBe('other')
  })
  it('appends a new feishu row when absent', () => {
    const rows: unknown[] = [{ id: 'other' }]
    const updated = upsertFeishuRow(rows, { appId: 'a', appSecret: 's' })
    expect(updated).toBe(false)
    expect(getFeishuConfig(rows)).toMatchObject({ appId: 'a', appSecret: 's' })
    expect(rows).toHaveLength(2)
  })
})

describe('readPatchRows / writePatchRows', () => {
  it('round-trips rows through yaml atomically', async () => {
    const home = await tempHome()
    try {
      const dir = path.join(home, 'profiles', 'feishu')
      await fs.mkdir(dir, { recursive: true })
      const rows: unknown[] = [{ id: 'feishu', config: { appId: 'a' } }, { id: 'keep', config: { x: 1 } }]
      await writePatchRows(dir, rows)
      const parsed = await readPatchRows(dir)
      expect(parsed).toEqual(rows)
      const found = getFeishuConfig(parsed)
      expect(found?.appId).toBe('a')
      // no leftover temp file
      const files = await fs.readdir(dir)
      expect(files).toEqual([PATCH_FILENAME])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('updates a feishu row nested inside an insert block', async () => {
    const home = await tempHome()
    try {
      const dir = path.join(home, 'profiles', 'feishu')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.join(dir, PATCH_FILENAME),
        [
          '- insert:',
          '    - id: feishu',
          '      config:',
          '        appId: cli_inner',
          '- id: other',
        ].join('\n') + '\n',
        'utf8',
      )
      await applyFeishuConfig('feishu', { appSecret: 's2', domain: 'lark' }, { env: { DSH_HOME: home } })
      const rows = await readPatchRows(dir)
      const feishu = getFeishuConfig(rows)
      expect(feishu).toMatchObject({ appId: 'cli_inner', appSecret: 's2', domain: 'lark' })
      expect(rows.map((r) => (r as { id?: string }).id)).toContain('other')
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('throws on a non-array patch file', async () => {
    const home = await tempHome()
    try {
      const dir = path.join(home, 'profiles', 'feishu')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, PATCH_FILENAME), 'just: a mapping\n', 'utf8')
      await expect(readPatchRows(dir)).rejects.toThrow(/top-level array/)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe('applyFeishuConfig', () => {
  it('updates an existing feishu row and preserves other rows on disk', async () => {
    const home = await tempHome()
    try {
      const dir = path.join(home, 'profiles', 'feishu')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.join(dir, PATCH_FILENAME),
        [
          '- id: feishu',
          '  config:',
          '    appId: cli_old',
          '    appSecret: old-secret',
          '- id: llm-pi-ai',
          '  config:',
          '    provider: volcengine',
        ].join('\n') + '\n',
        'utf8',
      )
      await applyFeishuConfig('feishu', { appSecret: 'new-secret', domain: 'lark', dmPolicy: 'open', allowFrom: ['ou_2'] }, { env: { DSH_HOME: home } })
      const rows = await readPatchRows(dir)
      const feishu = getFeishuConfig(rows)
      expect(feishu).toMatchObject({ appId: 'cli_old', appSecret: 'new-secret', domain: 'lark', dmPolicy: 'open', allowFrom: ['ou_2'] })
      const other = rows.map((r) => (r as { id?: string }).id)
      expect(other).toContain('llm-pi-ai')
      expect(rows).toHaveLength(2)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('appends a feishu row when the profile patch has none', async () => {
    const home = await tempHome()
    try {
      const dir = path.join(home, 'profiles', 'feishu')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, PATCH_FILENAME), '- id: llm-pi-ai\n  config:\n    provider: p\n', 'utf8')
      await applyFeishuConfig('feishu', { appId: 'cli_x', appSecret: 's' }, { env: { DSH_HOME: home } })
      const rows = await readPatchRows(dir)
      const ids = rows.map((r) => (r as { id?: string }).id)
      expect(ids).toContain('feishu')
      expect(() => resolveProfileDir('missing', { env: { DSH_HOME: home } })).toThrow(/not found/)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
