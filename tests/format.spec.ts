import { describe, expect, it } from 'vitest'
import {
  BRAND_SHORT_MAX,
  DEFAULT_BRAND_HEADER,
  MAX_MESSAGE_LENGTH,
  applyBrandHeader,
  buildMarkdownPostPayload,
  buildMarkdownPostRows,
  buildOutboundPayload,
  buildTextPostPayload,
  hasMarkdownHint,
  shouldUseBrandHeader,
  stripMarkdownToPlainText,
} from '../src/format.ts'

describe('MAX_MESSAGE_LENGTH', () => {
  it('is the aligned 8000 ceiling', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(8000)
  })
})

describe('hasMarkdownHint', () => {
  it('detects rich markdown', () => {
    expect(hasMarkdownHint('## Heading')).toBe(true)
    expect(hasMarkdownHint('**bold**')).toBe(true)
    expect(hasMarkdownHint('```\ncode\n```')).toBe(true)
    expect(hasMarkdownHint('- item')).toBe(true)
    expect(hasMarkdownHint('[link](https://x)')).toBe(true)
  })
  it('rejects plain prose', () => {
    expect(hasMarkdownHint('just some text')).toBe(false)
    expect(hasMarkdownHint('')).toBe(false)
  })
})

describe('buildMarkdownPostPayload / rows', () => {
  it('wraps a simple body in a single zh_cn md row', () => {
    const payload = JSON.parse(buildMarkdownPostPayload('hello'))
    expect(payload).toEqual({ zh_cn: { content: [[{ tag: 'md', text: 'hello' }]] } })
  })

  it('aligns rows at fence boundaries (never splits a code block)', () => {
    const content = 'before\n```ts\nconst x = 1\n```\nafter'
    const rows = buildMarkdownPostRows(content)
    // rows: prose before | full code fence row | prose after
    expect(rows).toHaveLength(3)
    expect(rows[0][0].text).toBe('before')
    expect(rows[1][0].text).toBe('```ts\nconst x = 1\n```')
    expect(rows[2][0].text).toBe('after')
  })

  it('keeps prose in a single row (rows split only at fence boundaries)', () => {
    const rows = buildMarkdownPostRows('a\n\nb')
    expect(rows).toHaveLength(1)
    expect(rows[0][0].text).toBe('a\n\nb')
  })

  it('handles empty content', () => {
    expect(buildMarkdownPostRows('')).toEqual([[{ tag: 'md', text: '' }]])
  })
})

describe('buildTextPostPayload', () => {
  it('builds a post payload for a prose row', () => {
    expect(JSON.parse(buildTextPostPayload('x'))).toEqual({ zh_cn: { content: [[{ tag: 'md', text: 'x' }]] } })
  })
})

describe('stripMarkdownToPlainText', () => {
  it('strips common markdown syntax', () => {
    expect(stripMarkdownToPlainText('**bold**')).toBe('bold')
    expect(stripMarkdownToPlainText('[l](https://x)')).toBe('l (https://x)')
    expect(stripMarkdownToPlainText('## head')).toBe('head')
  })
})

describe('buildOutboundPayload', () => {
  it('chooses post for rich content and text otherwise', () => {
    expect(buildOutboundPayload('**x**').msgType).toBe('post')
    expect(buildOutboundPayload('plain').msgType).toBe('text')
    expect(buildOutboundPayload('plain', { preferPost: true }).msgType).toBe('post')
  })
})

describe('brand header', () => {
  it('is applied to rich or long content by default', () => {
    expect(shouldUseBrandHeader('**bold**')).toBe(true)
    expect(shouldUseBrandHeader('x'.repeat(BRAND_SHORT_MAX + 1))).toBe(true)
    expect(shouldUseBrandHeader('short plain reply')).toBe(false)
    expect(applyBrandHeader('hello')).toBe('hello')
    expect(applyBrandHeader('**bold**')).toBe(`${DEFAULT_BRAND_HEADER}\n\n**bold**`)
  })
  it('is disabled when enabled=false or custom header is empty', () => {
    expect(shouldUseBrandHeader('**bold**', { header: DEFAULT_BRAND_HEADER, enabled: false })).toBe(false)
    expect(applyBrandHeader('long '.repeat(80), { header: '', enabled: true })).not.toContain('DeepSeek')
  })
})

describe('markdown table assertions', () => {
  it('treats tables as markdown hint (rendering itself is not a promise, but the table is not force-downgraded)', () => {
    expect(hasMarkdownHint('| a | b |\n| - | - |')).toBe(true)
  })
})
