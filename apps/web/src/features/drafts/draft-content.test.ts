import { describe, expect, it } from 'vitest'
import * as v1 from '@/lib/export/v1-fixtures'
import { defaultSubmitMessage, draftHref, draftLabel } from './draft-content'
import { proposalText } from './proposal-text'
import type { Draft } from '@/lib/drafts/types'

const at = '2026-10-11T00:00:00.000Z'
const cs = v1.conceptSet(1)
const csDraft = (targetId: number | null): Draft => ({ id: 'a', kind: 'concept-set', targetId, baseCommit: null, createdAt: at, updatedAt: at, content: { ...cs, id: 401 } })
const mapping: Draft = { id: 'm', kind: 'mapping-recommendations', targetId: null, baseCommit: null, createdAt: at, updatedAt: at, content: { translations: { en: { content: '# Hi' } } } }
const options = { toolTag: 'tool', date: '2026-10-11', modifiedBy: 'Ada', repoUrl: 'https://github.com/o/r' }

describe('draft content helpers', () => {
  it('labels and links drafts, without cross-language fallback', () => {
    expect(draftLabel(csDraft(1), 'en')).toBe(cs.metadata.translations.en.name)
    expect(draftLabel(csDraft(1), 'de')).toBeNull()
    expect(draftLabel(mapping, 'en')).toBeNull()
    expect(draftHref(csDraft(null))).toBe('/concept-sets/401')
    expect(draftHref(mapping)).toBe('/mapping')
  })

  it('writes concept sets as stamped INDICATE JSON and other kinds as their file', () => {
    const text = proposalText(csDraft(1), options)
    expect(text).toContain('"createdByTool": "tool"')
    expect(text).toContain('"modifiedBy": "Ada"')
    expect(text.endsWith('}\n')).toBe(true)
    expect(proposalText(mapping, options)).toBe('{\n  "translations": {\n    "en": {\n      "content": "# Hi"\n    }\n  }\n}\n')
  })

  it('offers an English commit message', () => {
    const name = cs.metadata.translations.en.name
    expect(defaultSubmitMessage(csDraft(null))).toBe(`Add concept set "${name}"`)
    expect(defaultSubmitMessage(csDraft(401))).toBe(`Update concept set 401 "${name}"`)
    expect(defaultSubmitMessage(csDraft(401), { reviewsOnly: true })).toBe(`Review concept set 401 "${name}"`)
    expect(defaultSubmitMessage(mapping)).toBe('Update mapping recommendations')
  })
})
