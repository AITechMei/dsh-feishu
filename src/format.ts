/**
 * Outbound reply formatting: Feishu native Markdown post rendering plus a
 * plain-text fallback path. Decides at the whole-message level whether to
 * send `msg_type: post` (rendered Markdown) or `msg_type: text`, aligning
 * fence-block boundaries so code blocks are never split mid-fence.
 * @module @aitechmei/dsh-feishu
 */

/** Conservative ceiling for a single outbound message, far under Feishu's
 *  text-message limit. Content above this is downgraded to plain `text`. */
export const MAX_MESSAGE_LENGTH = 8000

/** A Feishu post row: a list of markdown elements rendered inside one `md` tag. */
export type PostRow = Array<{ tag: 'md'; text: string }>

/** The parsed outbound shape: a JSON string plus the message type to send. */
export interface OutboundPayload {
  msgType: 'post' | 'text'
  content: string
}

/** Default DeepSeek brand header for rich/long replies. */
export const DEFAULT_BRAND_HEADER = '**🐋 DeepSeek**'

/** Replies at or above this plain-text length get the brand header. */
export const BRAND_SHORT_MAX = 200

const MARKDOWN_HINT_RE = /(^\|.*\|\s*\n\|[-:|\s]+\|)|(^#{1,6}\s)|(^\s*[-*]\s)|(^\s*\d+\.\s)|(^\s*---+\s*$)|(```)|(`[^`\n]+`)|(\*\*[^*\n].+?\*\*)|(~~[^~\n].+?~~)|(<u>.+?<\/u>)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))|(^>\s)/m

const FENCE_OPEN_RE = /^```([^\n`]*)\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

/**
 * Detect whether a message contains rich content worth rendering as Markdown
 * (headings, lists, code, bold/italic/strike, links, blockquotes, tables).
 */
export function hasMarkdownHint(content: string): boolean {
  return MARKDOWN_HINT_RE.test(content)
}

/** Wrap content into a Feishu post payload with a single `md` row. */
export function buildTextPostPayload(content: string): string {
  return JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: content }]] } })
}

/**
 * Split Markdown into per-fence post rows so a fenced code block is never cut
 * mid-block. Returns a list of rows, each a single `md` element.
 */
export function buildMarkdownPostRows(content: string): PostRow[] {
  if (!content) return [[{ tag: 'md', text: '' }]]
  if (!content.includes('```')) return [[{ tag: 'md', text: content }]]

  const rows: PostRow[] = []
  let current: string[] = []
  let inCodeBlock = false

  const flush = (): void => {
    if (current.length === 0) return
    const segment = current.join('\n')
    if (segment.trim().length > 0) rows.push([{ tag: 'md', text: segment }])
    current = []
  }

  for (const rawLine of content.split('\n')) {
    const strippedLine = rawLine.trim()
    const isFence = inCodeBlock
      ? FENCE_CLOSE_RE.test(strippedLine)
      : FENCE_OPEN_RE.test(strippedLine)
    if (isFence) {
      if (!inCodeBlock) flush()
      current.push(rawLine)
      inCodeBlock = !inCodeBlock
      if (!inCodeBlock) flush()
      continue
    }
    current.push(rawLine)
  }
  flush()
  return rows.length > 0 ? rows : [[{ tag: 'md', text: content }]]
}

/** Build the `post` JSON string for markdown content. */
export function buildMarkdownPostPayload(content: string): string {
  return JSON.stringify({ zh_cn: { content: buildMarkdownPostRows(content) } })
}

/** Strip markdown formatting to plain text for the text fallback path. */
export function stripMarkdownToPlainText(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
}

/**
 * Whether the brand header should be prepended: rich markdown content, or a
 * reply whose rendered (plain) length clears the short-reply threshold.
 */
export function shouldUseBrandHeader(
  content: string,
  options: { header: string; enabled: boolean; maxShort?: number } = {
    header: DEFAULT_BRAND_HEADER,
    enabled: true,
  },
): boolean {
  if (!options.enabled) return false
  const plain = stripMarkdownToPlainText(content)
  return hasMarkdownHint(content) || plain.length >= (options.maxShort ?? BRAND_SHORT_MAX)
}

/**
 * Prepend the brand header to a reply whose content warrants it.
 */
export function applyBrandHeader(
  content: string,
  options: { header?: string; enabled?: boolean; maxShort?: number } = {},
): string {
  if (!shouldUseBrandHeader(content, {
    header: options.header ?? DEFAULT_BRAND_HEADER,
    enabled: options.enabled ?? true,
    maxShort: options.maxShort,
  })) {
    return content
  }
  const header = options.header ?? DEFAULT_BRAND_HEADER
  return `${header}\n\n${content}`
}

/**
 * Choose an outbound message type + payload for one message.
 * @param content - the reply text.
 * @param options.preferPost - force `post` even when this chunk has no local
 *   markdown hint (used when a long markdown reply was split at the length
 *   ceiling so chunked plain-prose keeps rendering as the same type).
 */
export function buildOutboundPayload(
  content: string,
  options: { preferPost?: boolean } = {},
): OutboundPayload {
  if (options.preferPost === true || hasMarkdownHint(content)) {
    return { msgType: 'post', content: buildMarkdownPostPayload(content) }
  }
  return { msgType: 'text', content: JSON.stringify({ text: content }) }
}

/** Error message pattern the API uses to reject an invalid `post` payload. */
export const POST_CONTENT_INVALID_RE = /content format of the post type is incorrect/i
