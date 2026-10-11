import { useEffect, useState } from 'react'
import { getDictionarySource } from '@/lib/data'
import { getVocabularySource } from '@/lib/vocabulary'
import { useDraftsStore } from '@/stores/drafts-store'
import { customIds, nextCustomConceptId } from '../lib/expression'
import type { ExpressionItem } from '@data-dictionary/format'

// v1's lists when no vocabulary is loaded (legacy/concept-sets.js FALLBACK_DOMAINS / FALLBACK_CLASSES).
export const FALLBACK_DOMAINS = [
  'Condition', 'Device', 'Drug', 'Gender', 'Measurement', 'Metadata', 'Observation', 'Procedure', 'Provider', 'Race',
  'Spec Anatomic Site', 'Specimen', 'Type Concept', 'Unit', 'Visit',
]
export const FALLBACK_CLASSES = [
  'Clinical Finding', 'Clinical Observation', 'Context-dependent', 'Disorder', 'Lab Test', 'Observable Entity', 'Organism',
  'Pharma/Biol Product', 'Physical Object', 'Procedure', 'Qualifier Value', 'Staging / Scales', 'Substance',
]

/** Domains and concept classes to pick from: the loaded vocabulary's, else v1's short lists. */
export function useDomainAndClassOptions(): { domains: string[]; classes: string[] } {
  const [options, setOptions] = useState({ domains: FALLBACK_DOMAINS, classes: FALLBACK_CLASSES })
  useEffect(() => {
    let cancelled = false
    getVocabularySource()
      .getFilterOptions()
      .then((o) => {
        if (cancelled) return
        setOptions({
          domains: o.domains.length ? o.domains : FALLBACK_DOMAINS,
          classes: o.conceptClasses.length ? o.conceptClasses : FALLBACK_CLASSES,
        })
      })
      .catch(() => undefined) // No vocabulary: the fallback lists stay.
    return () => {
      cancelled = true
    }
  }, [])
  return options
}

/**
 * The next free custom concept id, above every custom id of the catalog (all
 * sets, from the source), of this user's drafts and of `items`. null while the
 * catalog's are loading.
 */
export function useNextCustomId(items: readonly ExpressionItem[]): number | null {
  const drafts = useDraftsStore((s) => s.drafts)
  const [catalogIds, setCatalogIds] = useState<number[] | null>(null)
  useEffect(() => {
    let cancelled = false
    getDictionarySource()
      .listCustomConcepts()
      .then((list) => !cancelled && setCatalogIds(list.map((c) => c.conceptId)))
      .catch((error) => {
        console.warn('Could not list the catalog’s custom concepts', error)
        if (!cancelled) setCatalogIds([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (catalogIds === null) return null
  const draftIds = drafts.flatMap((d) => (d.kind === 'concept-set' ? customIds(d.content.expression?.items) : []))
  return nextCustomConceptId([...catalogIds, ...draftIds, ...customIds(items)])
}
