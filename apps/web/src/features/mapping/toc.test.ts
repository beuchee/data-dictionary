import { describe, expect, it } from 'vitest'
import { extractHeadings, headingSlug, plainHeadingText, visibleSections } from './toc'

describe('extractHeadings', () => {
  it('lists h2 and h3 with MarkdownRenderer-compatible ids', () => {
    const md = '# Title\n\n## OMOP CDM\n\ntext\n\n### Granularité\n\n#### Deep\n\n## Références'
    expect(extractHeadings(md)).toEqual([
      { level: 2, text: 'OMOP CDM', id: 'omop-cdm' },
      { level: 3, text: 'Granularité', id: 'granularite' },
      { level: 2, text: 'Références', id: 'references' },
    ])
  })

  it('skips fenced code and strips inline markdown', () => {
    const md = '```md\n## Not a heading\n```\n## **Lab** `mapping` [link](http://x) ##\n~~~\n### nor this\n~~~'
    expect(extractHeadings(md)).toEqual([{ level: 2, text: 'Lab mapping link', id: 'lab-mapping-link' }])
  })

  it('keeps repeated headings, with the same id', () => {
    expect(extractHeadings('## FHIR\n## FHIR').map((h) => h.id)).toEqual(['fhir', 'fhir'])
  })

  it('handles an empty document and requires a space after #', () => {
    expect(extractHeadings('')).toEqual([])
    expect(extractHeadings('##NoSpace\n#hashtag')).toEqual([])
  })
})

describe('slugs', () => {
  it('folds accents and punctuation', () => {
    expect(headingSlug('Séjours (VISIT_OCCURRENCE / VISIT_DETAIL)')).toBe('sejours-visit-occurrence-visit-detail')
    expect(plainHeadingText('*Gender* (PERSON table)')).toBe('Gender (PERSON table)')
    expect(plainHeadingText('_Visits_ in VISIT_OCCURRENCE')).toBe('Visits in VISIT_OCCURRENCE')
  })
})

describe('visibleSections', () => {
  it('marks every section overlapping the view', () => {
    // Sections: [0,100) [100,400) [400,1000)
    expect(visibleSections([0, 100, 400], 1000, 150, 450)).toEqual([1, 2])
    expect(visibleSections([0, 100, 400], 1000, 0, 50)).toEqual([0])
    expect(visibleSections([], 1000, 0, 50)).toEqual([])
  })
})
