// From linkr@1310cf4a4 apps/web/src/components/editor/MarkdownToolbar.tsx
// (getFormatTokens, applyMarkdownFormat), without the formats the dictionary's
// Markdown renderer does not support (math, mermaid, callouts, details, toc).

export type MarkdownFormat =
  | 'bold' | 'italic' | 'strikethrough'
  | 'h1' | 'h2' | 'h3'
  | 'ul' | 'ol' | 'checklist'
  | 'code' | 'codeblock' | 'quote'
  | 'link' | 'image' | 'hr' | 'table'

interface FormatTokens {
  before: string
  after: string
  placeholder: string
  newlinePrefix?: string
}

const TOKENS: Record<MarkdownFormat, FormatTokens> = {
  bold: { before: '**', after: '**', placeholder: 'bold text' },
  italic: { before: '_', after: '_', placeholder: 'italic text' },
  strikethrough: { before: '~~', after: '~~', placeholder: 'strikethrough' },
  h1: { before: '', after: '', placeholder: '', newlinePrefix: '# ' },
  h2: { before: '', after: '', placeholder: '', newlinePrefix: '## ' },
  h3: { before: '', after: '', placeholder: '', newlinePrefix: '### ' },
  ul: { before: '', after: '', placeholder: '', newlinePrefix: '- ' },
  ol: { before: '', after: '', placeholder: '', newlinePrefix: '1. ' },
  checklist: { before: '', after: '', placeholder: '', newlinePrefix: '- [ ] ' },
  code: { before: '`', after: '`', placeholder: 'code' },
  codeblock: { before: '```\n', after: '\n```', placeholder: 'code' },
  quote: { before: '', after: '', placeholder: '', newlinePrefix: '> ' },
  link: { before: '[', after: '](url)', placeholder: 'link text' },
  image: { before: '![', after: '](url)', placeholder: 'alt text' },
  hr: { before: '\n---\n', after: '', placeholder: '' },
  table: { before: '', after: '', placeholder: '' },
}

/**
 * `text` with `format` applied to the selection `[start, end)` (or inserted at
 * the cursor), and the selection to restore afterwards.
 */
export function applyMarkdownFormat(
  text: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): { text: string; cursorStart: number; cursorEnd: number } {
  const selected = text.substring(start, end)
  const { before, after, placeholder, newlinePrefix } = TOKENS[format]
  const head = text.substring(0, start)
  const tail = text.substring(end)

  if (newlinePrefix) {
    if (selected) {
      const prefixed = selected.split('\n').map((line) => `${newlinePrefix}${line}`).join('\n')
      return { text: head + prefixed + tail, cursorStart: start, cursorEnd: start + prefixed.length }
    }
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const cursor = lineStart + newlinePrefix.length + (start - lineStart)
    return { text: text.substring(0, lineStart) + newlinePrefix + text.substring(lineStart), cursorStart: cursor, cursorEnd: cursor }
  }
  if (format === 'table') {
    const table = '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| | | |\n'
    return { text: head + table + tail, cursorStart: start + table.length, cursorEnd: start + table.length }
  }
  if (format === 'hr') {
    const hr = '\n\n---\n\n'
    return { text: head + hr + tail, cursorStart: start + hr.length, cursorEnd: start + hr.length }
  }
  if (format === 'link' || format === 'image') {
    const bang = format === 'image' ? '!' : ''
    const label = selected || placeholder
    const insert = `${bang}[${label}](url)`
    // With a selection, select `url`; without one, the placeholder label.
    const cursorStart = selected ? start + bang.length + label.length + 3 : start + bang.length + 1
    const cursorEnd = selected ? cursorStart + 3 : cursorStart + label.length
    return { text: head + insert + tail, cursorStart, cursorEnd }
  }
  const body = selected || placeholder
  const cursorStart = start + before.length
  return { text: head + before + body + after + tail, cursorStart, cursorEnd: cursorStart + body.length }
}
