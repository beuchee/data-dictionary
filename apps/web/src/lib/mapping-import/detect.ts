import { unzipSync } from 'fflate'
import { ccrTables, findColumn } from './formats'
import { extensionOf, isTabular, readCells, tableFromCells } from './table'
import { decode, headerKey } from './text'
import { parseId } from './values'
import { MappingImportError, type ColumnRole, type ColumnRoles, type InputFile, type MappingFormat, type ParseOptions } from './types'

/** Uncompressed bytes a ZIP may expand to (zip bombs). */
export const MAX_UNZIPPED_BYTES = 1024 ** 3

function skipEntry(name: string): boolean {
  if (name.endsWith('/')) return true
  if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) return true
  return (name.split('/').pop() ?? '').startsWith('.')
}

/** ZIPs replaced by their entries (folders kept in the names; directories, `__MACOSX` and dotfiles dropped). */
export function expandFiles(files: readonly InputFile[]): InputFile[] {
  const out: InputFile[] = []
  for (const file of files) {
    if (extensionOf(file.name) !== '.zip') {
      out.push(file)
      continue
    }
    let total = 0
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(file.data, {
        filter: (f) => {
          if (skipEntry(f.name)) return false
          total += f.originalSize
          if (total > MAX_UNZIPPED_BYTES) throw new MappingImportError('bad_zip', 'too large')
          return true
        },
      })
    } catch (error) {
      if (error instanceof MappingImportError) throw error
      throw new MappingImportError('bad_zip', file.name)
    }
    for (const [name, data] of Object.entries(entries)) out.push({ name, data })
  }
  return out
}

const ROLE_NAMES: [ColumnRole, string[]][] = [
  ['targetConceptId', ['target_concept_id', 'concept_id', 'omop_concept_id', 'standard_concept_id', 'target_id', 'omop_id', 'omop']],
  ['sourceConceptId', ['source_concept_id']],
  ['sourceCode', ['source_code', 'code', 'source_value', 'concept_code', 'local_code']],
  ['sourceVocabularyId', ['source_vocabulary_id', 'vocabulary_id', 'vocabulary', 'terminology', 'source_vocabulary', 'vocab']],
  ['sourceName', ['source_code_description', 'source_name', 'source_label', 'label', 'name', 'description', 'concept_name', 'libelle', 'libellé']],
  ['status', ['status', 'mapping_status', 'statut']],
  ['equivalence', ['equivalence', 'predicate_id', 'predicate']],
  ['frequency', ['frequency', 'source_frequency', 'count', 'record_count', 'records', 'n', 'nb']],
]

/** Column roles guessed from header names (each header used once). */
export function guessRoles(headers: readonly string[]): ColumnRoles {
  const keys = headers.map(headerKey)
  const used = new Set<number>()
  const roles: ColumnRoles = {}
  for (const [role, names] of ROLE_NAMES) {
    for (const name of names) {
      const i = keys.indexOf(headerKey(name))
      if (i >= 0 && !used.has(i)) {
        roles[role] = headers[i]
        used.add(i)
        break
      }
    }
  }
  return roles
}

export interface Detection {
  format: MappingFormat
  /** Options to start from (`hasHeader` for a bare list, guessed `columns` for a generic table). */
  options: Partial<ParseOptions>
}

/**
 * The likely format of (already unzipped) files: Linkr by its JSON, C/CR by its
 * relationship table, then by the first table's headers: SSSOM, Usagi, STCM, a
 * single column of ids, else a generic table with guessed roles.
 */
export function detectFormat(files: readonly InputFile[], options: Partial<ParseOptions> = {}): Detection {
  if (files.length === 0) throw new MappingImportError('no_file')
  if (files.some((f) => extensionOf(f.name) === '.json')) return { format: 'linkr', options: {} }
  const tabular = files.filter(isTabular)
  if (tabular.length === 0) throw new MappingImportError('unsupported_file', files[0].name)
  if (tabular.length > 1 && ccrTables(tabular, { format: 'ccr', ...options }).relationship) {
    return { format: 'ccr', options: {} }
  }
  const file = tabular[0]
  if (extensionOf(file.name) !== '.xlsx' && decode(file.data, options.encoding).startsWith('#')) {
    return { format: 'sssom', options: {} }
  }
  const { cells } = readCells(file, options)
  const { headers } = tableFromCells(cells, { ...options, hasHeader: true })
  const has = (...names: string[]) => names.every((n) => findColumn(headers, n) >= 0)
  if (has('subject_id', 'object_id')) return { format: 'sssom', options: {} }
  if (has('sourceCode', 'conceptId', 'mappingStatus')) return { format: 'usagi', options: {} }
  if (has('source_code', 'target_concept_id')) return { format: 'stcm', options: {} }
  if (has('concept_id_1', 'concept_id_2', 'relationship_id')) return { format: 'ccr', options: {} }
  if (headers.length === 1) {
    const skip = Math.max(0, options.skipRows ?? 0)
    const rows = cells.slice(skip)
    const hasHeader = rows.length > 0 && parseId(rows[0][0]) === null
    const data = rows.slice(hasHeader ? 1 : 0)
    if (data.some((r) => parseId(r[0]) !== null)) {
      return { format: 'concept_ids', options: { hasHeader } }
    }
  }
  return { format: 'generic', options: { columns: guessRoles(headers) } }
}
