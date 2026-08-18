import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('feishu invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    let installer: (() => void) | undefined
    const register = vi.fn((_name: string, fn: () => void) => { installer = fn; return () => {} })
    const ctx = { invariants: { register } } as unknown as Context
    const dispose = await apply(ctx)
    expect(name).toBe('feishu-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@aitechmei/dsh-feishu', expect.any(Function))
    installer!()
    dispose()
  })
})