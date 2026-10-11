import { getVocabularySource, type OmopConcept } from '@/lib/vocabulary'
import { useVocabularyQuery } from '@/features/vocabulary/use-vocabulary-query'
import type { ConceptRef } from './unit-rows'

export function toConceptRef(c: OmopConcept): ConceptRef {
  return {
    conceptId: c.conceptId,
    conceptName: c.conceptName,
    conceptCode: c.conceptCode,
    vocabularyId: c.vocabularyId,
    domainId: c.domainId,
  }
}

/** Whether a vocabulary is loaded: decides between the picker and manual entry. */
export function useVocabularyAvailable(): 'loading' | 'yes' | 'no' {
  const state = useVocabularyQuery('vocabulary-info', () => getVocabularySource().getInfo())
  if (state.status === 'ready') return state.data.available ? 'yes' : 'no'
  if (state.status === 'unavailable' || state.status === 'error') return 'no'
  return 'loading'
}
