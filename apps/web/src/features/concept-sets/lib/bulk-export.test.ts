import { describe, expect, it } from 'vitest'
import { conceptSetSummary } from '@/lib/data/catalog'
import * as v1 from '@/lib/export/v1-fixtures'
import { bulkExportFilename, bulkExportIds, bulkExportJson, loadAll } from './bulk-export'

const make = (id: number, category: string) => {
  const cs = v1.conceptSet(1)
  return conceptSetSummary({ ...cs, id, metadata: { ...cs.metadata, translations: { en: { category } } } }, null)
}
const summaries = [make(3, 'Labs'), make(1, 'Vitals'), make(2, 'Labs')]

describe('bulk export', () => {
  it('selects by selection, category (in the content language) or all', () => {
    expect(bulkExportIds(summaries, 'all', { lang: 'en' })).toEqual([1, 2, 3])
    expect(bulkExportIds(summaries, 'selected', { lang: 'en', selected: new Set([3, 9]) })).toEqual([3])
    expect(bulkExportIds(summaries, 'category', { lang: 'en', category: 'Labs' })).toEqual([2, 3])
    expect(bulkExportIds(summaries, 'category', { lang: 'fr', category: 'Labs' })).toEqual([])
  })

  it('names files as v1', () => {
    expect(bulkExportFilename('all')).toBe('concept_sets_all.json')
    expect(bulkExportFilename('category', 'Signes vitaux & co')).toBe('concept_sets_signes_vitaux___co.json')
  })

  it('writes a JSON array of files', () => {
    const text = bulkExportJson([v1.conceptSet(1)])
    expect(JSON.parse(text)).toHaveLength(1)
    expect(text.startsWith('[\n  {\n    "id": 1,')).toBe(true)
  })

  it('loads in order and counts failures', async () => {
    const { conceptSets, missing } = await loadAll([5, 6, 7, 8], async (id) => {
      if (id === 6) throw new Error('boom')
      if (id === 7) return null
      await new Promise((r) => setTimeout(r, 8 - id))
      return { ...v1.conceptSet(1), id }
    }, 2)
    expect(conceptSets.map((cs) => cs.id)).toEqual([5, 8])
    expect(missing).toBe(2)
  })
})
