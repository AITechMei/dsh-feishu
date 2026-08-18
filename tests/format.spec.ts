import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_LENGTH,
  POST_CONTENT_INVALID_RE,
  buildMarkdownPostPayload,
  buildMarkdownPostRows,
  buildOutboundPayload,
  buildTextPostPayload,
  hasMarkdownHint,
  stripMarkdownToPlainText,
} from '../src/format.ts'

describe('format module surface (M1 skeleton)', () => {
  it('exports the message-length ceiling', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(8000)
  })

  it('exports the post-invalid error pattern', () => {
    expect(POST_CONTENT_INVALID_RE.test('content format of the post type is incorrect')).toBe(true)
  })

  it('exports the public functions as callables', () => {
    for (const fn of [
      hasMarkdownHint,
      buildTextPostPayload,
      buildMarkdownPostRows,
      buildMarkdownPostPayload,
      stripMarkdownToPlainText,
      buildOutboundPayload,
    ]) {
      expect(typeof fn).toBe('function')
    }
  })
})
