// Mapping import: files of any supported format → normalized MappingRow[].
// Plan: docs/planning/v2-plan.md §7. Twin: apps/api/app/services/mapping_import/.
import { expandFiles } from './detect'
import { firstTabular, parseCcr, parseConceptIds, parseGeneric, parseLinkr, parseSssom, parseStcm, parseUsagi } from './formats'
import { readTable } from './table'
import { MappingImportError, type InputFile, type ParseOptions, type ParseResult } from './types'

export * from './types'
export { detectFormat, expandFiles, guessRoles, type Detection } from './detect'
export { readCells, readTable, tableFromCells, type Table } from './table'
export { coverageTargets, statusCounts, sourcesByTarget, type SourceRef, type StatusFilter } from './coverage'

/** Parse `files` (ZIPs expanded first) as `options.format`. Throws `MappingImportError`. */
export function parseMapping(files: readonly InputFile[], options: ParseOptions): ParseResult {
  const expanded = expandFiles(files)
  if (expanded.length === 0) throw new MappingImportError('no_file')
  switch (options.format) {
    case 'generic':
      return parseGeneric(readTable(firstTabular(expanded), options), options)
    case 'concept_ids':
      return parseConceptIds(expanded, options)
    case 'stcm':
      return parseStcm(readTable(firstTabular(expanded), options))
    case 'usagi':
      return parseUsagi(readTable(firstTabular(expanded), options))
    case 'ccr':
      return parseCcr(expanded, options)
    case 'sssom':
      return parseSssom(expanded, options)
    case 'linkr':
      return parseLinkr(expanded)
  }
}
