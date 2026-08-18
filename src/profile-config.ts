/**
 * Profile patch read/writer: parse the profile's `cordis.patch.yml`, update
 * the `feishu` row's config while preserving every other row, and write it
 * back atomically via a temp-file rename.
 * @module @aitechmei/dsh-feishu
 */

import { existsSync, statSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import YAML from 'yaml'
import type { FeishuConfig } from './types.ts'

/** The patch file name inside each profile directory. */
export const PATCH_FILENAME = 'cordis.patch.yml'

/** Environment interface so tests can inject DSH_HOME without global pollution. */
export interface ProfileEnv {
  DSH_HOME?: string
  HOME?: string
}

/** Resolve the dsh home directory (``$DSH_HOME`` or ``~/.dsh``). */
export function resolveDshHome(env: ProfileEnv = process.env): string {
  return env.DSH_HOME !== undefined && env.DSH_HOME.length > 0
    ? env.DSH_HOME
    : path.join(env.HOME ?? os.homedir(), '.dsh')
}

/**
 * Resolve a profile's directory. Throws when the profile does not exist and
 * `create` is not set, or when the resolved directory isn't a directory.
 */
export function resolveProfileDir(
  name: string,
  options: { env?: ProfileEnv; create?: boolean } = {},
): string {
  const env = options.env ?? process.env
  const dir = path.join(resolveDshHome(env), 'profiles', name)
  if (options.create === true) return dir
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`dsh profile "${name}" not found (looked in ${dir}). Create it first (e.g. dsh plugin setup).`)
  }
  return dir
}

/** A parsed `cordis.patch.yml`: a top-level array of patch rows. */
export type PatchRows = unknown[]

/** Locate a row with `id` (optionally descending into `insert` blocks). */
export function findRowById(rows: PatchRows, id: string): { array: unknown[]; index: number } | undefined {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!isRecord(row)) continue
    if (row.id === id) return { array: rows, index }
    if (Array.isArray(row.insert)) {
      const inner = findRowById(row.insert as PatchRows, id)
      if (inner !== undefined) return inner
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read and parse a profile's patch rows; throws if unreadable or not an array. */
export async function readPatchRows(dir: string): Promise<PatchRows> {
  const file = path.join(dir, PATCH_FILENAME)
  const text = await fs.readFile(file, 'utf8')
  const rows = YAML.parse(text) as unknown
  if (!Array.isArray(rows)) {
    throw new Error(`Patch file ${file} does not contain a top-level array`)
  }
  return rows
}

/** Whether the feishu row currently carries usable credentials. */
export function feishuConfigured(config: Partial<FeishuConfig> | undefined): boolean {
  return config !== undefined
    && typeof config.appId === 'string' && config.appId.length > 0
    && typeof config.appSecret === 'string' && config.appSecret.length > 0
}

/**
 * Merge the given config into the feishu row (keeping unrelated config keys),
 * or append a fresh feishu row when none exists. Returns true when an existing
 * row was found, false when one was appended.
 */
export function upsertFeishuRow(rows: PatchRows, config: Partial<FeishuConfig>): boolean {
  const existing = findRowById(rows, 'feishu')
  if (existing !== undefined) {
    const row = existing.array[existing.index] as Record<string, unknown>
    const existingConfig = isRecord(row.config) ? row.config as Record<string, unknown> : {}
    row.config = { ...existingConfig, ...config }
    return true
  }
  rows.push({ id: 'feishu', config: { ...config } })
  return false
}

/** Get the feishu row's config object, or undefined when absent. */
export function getFeishuConfig(rows: PatchRows): Partial<FeishuConfig> | undefined {
  const found = findRowById(rows, 'feishu')
  if (found === undefined) return undefined
  const config = (found.array[found.index] as Record<string, unknown>).config
  return isRecord(config) ? config as unknown as Partial<FeishuConfig> : undefined
}

/**
 * Serialize the rows and atomically write them to the profile's patch file
 * (write a temp sibling then rename so a crash never leaves a partial file).
 */
export async function writePatchRows(dir: string, rows: PatchRows): Promise<void> {
  const file = path.join(dir, PATCH_FILENAME)
  const text = YAML.stringify(rows)
  const temp = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temp, text, 'utf8')
    await fs.rename(temp, file)
  } catch (error) {
    // Never leave a partial temp sibling behind.
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/** High-level helper: read, upsert feishu config, write back atomically. */
export async function applyFeishuConfig(
  profileName: string,
  config: Partial<FeishuConfig>,
  options: { env?: ProfileEnv } = {},
): Promise<void> {
  const dir = resolveProfileDir(profileName, { env: options.env })
  const rows = await readPatchRows(dir)
  upsertFeishuRow(rows, config)
  await writePatchRows(dir, rows)
}
