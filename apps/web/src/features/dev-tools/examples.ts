// v1's example queries (legacy/dev-tools.js), labels translated.

export interface ExampleQuery {
  /** Key under `dev_tools.examples`. */
  id: string
  sql: string
}

export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  {
    id: 'vocabulary_counts',
    sql: 'SELECT vocabulary_id, COUNT(*) AS cnt\nFROM concept\nGROUP BY vocabulary_id\nORDER BY cnt DESC\nLIMIT 20',
  },
  {
    id: 'search_name',
    sql: "SELECT concept_id, concept_name, vocabulary_id, domain_id, standard_concept\nFROM concept\nWHERE LOWER(concept_name) LIKE '%heart rate%'\nAND standard_concept = 'S'\nLIMIT 50",
  },
  {
    id: 'descendants',
    sql: 'SELECT c.concept_id, c.concept_name, c.vocabulary_id, ca.min_levels_of_separation\nFROM concept_ancestor ca\nJOIN concept c ON c.concept_id = ca.descendant_concept_id\nWHERE ca.ancestor_concept_id = 4329847\nORDER BY ca.min_levels_of_separation\nLIMIT 50',
  },
  {
    id: 'maps_to',
    sql: "SELECT cr.relationship_id, c.concept_id, c.concept_name, c.vocabulary_id, c.standard_concept\nFROM concept_relationship cr\nJOIN concept c ON c.concept_id = cr.concept_id_2\nWHERE cr.concept_id_1 = 4329847\nAND cr.relationship_id = 'Maps to'\nLIMIT 50",
  },
  { id: 'domains', sql: 'SELECT * FROM domain ORDER BY domain_id' },
  { id: 'vocabularies', sql: 'SELECT vocabulary_id, vocabulary_name FROM vocabulary ORDER BY vocabulary_id' },
  { id: 'concept_classes', sql: 'SELECT * FROM concept_class ORDER BY concept_class_id' },
  {
    id: 'synonyms',
    sql: 'SELECT cs.concept_id, cs.concept_synonym_name, c.concept_name\nFROM concept_synonym cs\nJOIN concept c ON c.concept_id = cs.concept_id\nWHERE cs.concept_id = 4329847',
  },
  { id: 'describe', sql: 'DESCRIBE concept' },
]
