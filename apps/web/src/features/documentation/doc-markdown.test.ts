import { describe, expect, it } from 'vitest'
import { extractHeadings, hastText, headingId, inlineText, splitTitle } from './doc-markdown'

describe('headingId', () => {
  it('slugs like the Markdown renderer, folding accents', () => {
    expect(headingId('Détails d’un jeu de concepts')).toBe('details-d-un-jeu-de-concepts')
    expect(headingId('Reviewing & GitHub')).toBe('reviewing-github')
    expect(headingId('1. LOINC')).toBe('1-loinc')
    expect(headingId('Œdème')).toBe('oedeme')
    expect(headingId('---')).toBe('')
  })
})

describe('inlineText', () => {
  it('keeps the visible text of inline Markdown', () => {
    expect(inlineText('2. Make it yours: `config.json`')).toBe('2. Make it yours: config.json')
    expect(inlineText('**Bold** and *em* and [a link](https://x.org)')).toBe('Bold and em and a link')
    expect(inlineText('`source_to_concept_map` and snake_case_words')).toBe('source_to_concept_map and snake_case_words')
    expect(inlineText('_emphasis_ here')).toBe('emphasis here')
    expect(inlineText('1\\. Escaped')).toBe('1. Escaped')
  })
})

describe('splitTitle', () => {
  it('takes the first # heading out of the body', () => {
    const md = '<!-- TODO(v2): note -->\n\n# Title **here**\n\nIntro\n\n## Part'
    expect(splitTitle(md)).toEqual({ title: 'Title here', body: '<!-- TODO(v2): note -->\n\n\nIntro\n\n## Part' })
  })

  it('ignores # lines inside code blocks and returns null without a title', () => {
    const md = '```bash\n# a comment\n```\n\n## Only a section'
    expect(splitTitle(md)).toEqual({ title: null, body: md })
  })
})

describe('extractHeadings', () => {
  it('lists h2–h4 outside code fences, in order', () => {
    const md = [
      '# Page',
      '## First',
      '```sql',
      '## not a heading',
      '```',
      '### Second `code`',
      '#### Third',
      '##### Too deep',
      '~~~',
      '### fenced too',
      '~~~',
      '##No space is not a heading',
    ].join('\n')
    expect(extractHeadings(md)).toEqual([
      { level: 2, text: 'First', id: 'first', line: 2 },
      { level: 3, text: 'Second code', id: 'second-code', line: 6 },
      { level: 4, text: 'Third', id: 'third', line: 7 },
    ])
  })

  it('suffixes repeated headings so every anchor is unique', () => {
    const md = '## Unit conversions\n### Actions\n### Export\n## Recommended units\n### Actions\n### Export\n### Actions'
    expect(extractHeadings(md).map((h) => h.id)).toEqual([
      'unit-conversions', 'actions', 'export', 'recommended-units', 'actions-1', 'export-1', 'actions-2',
    ])
  })

  it('agrees with the id computed from the rendered heading text', () => {
    const [h] = extractHeadings('## 2. Make it yours: `config.json`')
    const rendered = {
      type: 'element',
      children: [{ type: 'text', value: '2. Make it yours: ' }, { type: 'element', children: [{ type: 'text', value: 'config.json' }] }],
    }
    expect(headingId(hastText(rendered))).toBe(h.id)
  })
})
