import { describe, expect, it } from 'vitest'
import {
  createTableSql,
  emptyTableSql,
  filterIdInserts,
  missingTables,
  pickAthenaFiles,
  readerSql,
  registeredName,
  tableOfFile,
  typedSelectSql,
} from './athena-files'

describe('ATHENA files', () => {
  it('recognises the vocabulary tables, whatever the case or folder', () => {
    expect(tableOfFile('CONCEPT.csv')).toBe('concept')
    expect(tableOfFile('athena/concept_ancestor.parquet')).toBe('concept_ancestor')
    expect(tableOfFile('C:\\export\\CONCEPT_SYNONYM.CSV')).toBe('concept_synonym')
    for (const name of ['DRUG_STRENGTH.csv', 'CONCEPT.csv.bak', 'readme.txt', 'CONCEPT', '.csv']) {
      expect(tableOfFile(name)).toBeNull()
    }
    expect(tableOfFile('DRUG_STRENGTH.csv', ['drug_strength'])).toBe('drug_strength')
  })

  it('prefers Parquet over CSV for the same table', () => {
    const picked = pickAthenaFiles([
      { name: 'CONCEPT.csv' },
      { name: 'CONCEPT.parquet' },
      { name: 'CONCEPT_ANCESTOR.parquet' },
      { name: 'CONCEPT_ANCESTOR.csv' },
      { name: 'notes.md' },
    ])
    expect(picked.get('concept')?.name).toBe('CONCEPT.parquet')
    expect(picked.get('concept_ancestor')?.name).toBe('CONCEPT_ANCESTOR.parquet')
    expect(missingTables(picked)).toEqual(['concept_relationship'])
  })

  it('registers files under its own names, never the user one', () => {
    expect(registeredName('concept', "x'); DROP TABLE concept; --.csv")).toBe('athena_concept.csv')
    expect(registeredName('concept', 'a.parquet')).toBe('athena_concept.parquet')
    expect(() => registeredName('concept; DROP', 'a.csv')).toThrow()
  })

  it('reads ATHENA tab-separated files unquoted', () => {
    expect(readerSql('athena_concept.csv', 'concept_id\tconcept_name')).toBe(
      "read_csv('athena_concept.csv', header=true, all_varchar=true, delim='\\t', quote='', escape='')",
    )
    expect(readerSql('athena_concept.csv', 'concept_id,concept_name')).toContain('auto_detect=true')
    expect(readerSql('athena_concept.parquet', '')).toBe("read_parquet('athena_concept.parquet')")
  })

  it('types every column and fills the missing ones with nulls', () => {
    const sql = typedSelectSql('concept_synonym', 'R', ['CONCEPT_ID', 'concept_synonym_name'])
    expect(sql).toBe(
      'SELECT TRY_CAST(concept_id AS BIGINT) AS concept_id, TRY_CAST(concept_synonym_name AS VARCHAR) AS concept_synonym_name, ' +
        'CAST(NULL AS BIGINT) AS language_concept_id FROM R',
    )
    expect(typedSelectSql('concept', 'R', ['valid_start_date'])).toContain(
      "COALESCE(TRY_CAST(valid_start_date AS DATE), TRY_STRPTIME(CAST(valid_start_date AS VARCHAR), '%Y%m%d')::DATE)",
    )
    expect(() => typedSelectSql('users', 'R', [])).toThrow()
  })

  it('keeps direct edges only, and the dictionary rows when filtering', () => {
    expect(createTableSql('concept_ancestor', 'S', true)).toBe(
      'CREATE TABLE concept_ancestor AS SELECT * FROM (S) WHERE min_levels_of_separation = 1',
    )
    expect(createTableSql('concept_relationship', 'S', true)).toContain('concept_id_2 IN (SELECT id FROM _filter_ids)')
    expect(createTableSql('concept_relationship', 'S', false)).toBe('CREATE TABLE concept_relationship AS SELECT * FROM (S)')
    expect(createTableSql('concept', 'S', true)).toBe('CREATE TABLE concept AS SELECT * FROM (S)')
    expect(emptyTableSql('domain')).toBe(
      'CREATE TABLE domain AS SELECT CAST(NULL AS VARCHAR) AS domain_id, CAST(NULL AS VARCHAR) AS domain_name, ' +
        'CAST(NULL AS BIGINT) AS domain_concept_id WHERE false',
    )
  })

  it('inserts only integer filter ids', () => {
    expect(filterIdInserts([1, 2, '3); DROP TABLE concept; --', 4.5, -1, 3], 2)).toEqual([
      'INSERT INTO _filter_ids VALUES (1), (2)',
      'INSERT INTO _filter_ids VALUES (3)',
    ])
    expect(filterIdInserts([])).toEqual([])
  })
})
