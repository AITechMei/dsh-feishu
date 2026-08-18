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

/**
 * Detect whether a message contains rich content worth rendering as Markdown
 * (headings, lists, code, bold/italic/strike, links, blockquotes, tables).
 */
export function hasMarkdownHint(content: string): boolean {
  throw new Error('Not implemented: M5')
}

/** Wrap plain text into a Feishu `post` payload for one row. */
export function buildTextPostPayload(content: string): string {
  throw new Error('Not implemented: M5')
}

/**
 * Split Markdown into per-fence `post` rows so a fenced code block is never
 * cut mid-block. Returns a list of rows, each a single `md` element.
 */
export function buildMarkdownPostRows(content: string): PostRow[] {
  throw new Error('Not implemented: M5')
}

/** Build the `post` JSON string for markdown content. */
export function buildMarkdownPostPayload(content: string): string {
  throw new Error('Not implemented: M5')
}

/** Strip markdown formatting to plain text for the `text` fallback. */
export function stripMarkdownToPlainText(content: string): string {
  throw new Error('Not implemented: M5')
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
  throw new Error('Not implemented: M5')
}

/** Error message pattern the API uses to reject an invalid `post` payload. */
export const POST_CONTENT_INVALID_RE = /content format of the post type is incorrect/i
