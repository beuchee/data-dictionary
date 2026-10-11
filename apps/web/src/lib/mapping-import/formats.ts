// One parser per format; each takes the (unzipped) files and returns normalized
// rows. Twin: apps/api/app/services/mapping_import/formats.py.
import { extensionOf, isTabular, readCells, readTable, tableFromCells, type Table } from './table'
import { clean, decode, headerKey, parseDelimited } from './text'
import { RowSink, equivalence, parseFrequency, parseId, parseTargets, status, text } from './values'
import { MappingImportError, type InputFile, type MappingRow, type ParseOptions, type ParseResult } from './types'

type Source = Omit<MappingRow, 'targetConceptId'>

/** Index of the first header matching one of `names` (compared by `headerKey`), or -1. */
export function findColumn(headers: readonly string[], ...names: string[]): number {
  const keys = headers.map(headerKey)
  for (const name of names) {
    const i = keys.indexOf(headerKey(name))
    if (i >= 0) return i
  }
  return -1
}

function cell(row: readonly string[], index: number): string | undefined {
  return index >= 0 ? row[index] : undefined
}

/** 0 is "no source concept" in STCM / Linkr. */
function sourceId(value: unknown): number | undefined {
  const id = parseId(value)
  return id ? id : undefined
}

function hasSource(source: Source): boolean {
  return source.sourceCode !== undefined || source.sourceName !== undefined || source.sourceConceptId !== undefined
}

/** Blank target and no source: nothing to keep. */
function addOrBlank(sink: RowSink, source: Source, target: string | undefined, row: number): void {
  if (!hasSource(source) && text(target) === undefined) sink.skip('blank_row', row)
  else sink.addCell(source, target, row)
}

function requireColumns(columns: Record<string, number>): void {
  const missing = Object.entries(columns)
    .filter(([, i]) => i < 0)
    .map(([name]) => name)
  if (missing.length) throw new MappingImportError('missing_columns', missing.join(', '))
}

export function firstTabular(files: readonly InputFile[]): InputFile {
  const file = files.find(isTabular)
  if (!file) throw new MappingImportError(files.length ? 'unsupported_file' : 'no_file', files[0]?.name ?? null)
  return file
}

// --- Generic table (user column roles) ---------------------------------------------------

export function parseGeneric(table: Table, options: ParseOptions): ParseResult {
  const roles = options.columns ?? {}
  const index = (role: keyof typeof roles) => {
    const name = roles[role]
    if (!name) return -1
    const i = table.headers.indexOf(name)
    if (i < 0) throw new MappingImportError('missing_columns', name)
    return i
  }
  if (!roles.targetConceptId) throw new MappingImportError('missing_columns', 'targetConceptId')
  const target = index('targetConceptId')
  const cols = {
    vocabulary: index('sourceVocabularyId'),
    code: index('sourceCode'),
    name: index('sourceName'),
    conceptId: index('sourceConceptId'),
    equivalence: index('equivalence'),
    status: index('status'),
    frequency: index('frequency'),
  }
  const sink = new RowSink()
  table.rows.forEach((r, i) => {
    sink.read()
    const source: Source = {
      sourceVocabularyId: text(cell(r, cols.vocabulary)),
      sourceCode: text(cell(r, cols.code)),
      sourceName: text(cell(r, cols.name)),
      sourceConceptId: sourceId(cell(r, cols.conceptId)),
      equivalence: text(cell(r, cols.equivalence)),
      status: status(cell(r, cols.status)),
      frequency: parseFrequency(cell(r, cols.frequency)),
    }
    addOrBlank(sink, source, cell(r, target), i + 1)
  })
  return sink.result('generic')
}

// --- A list of concept ids (v1 behaviour) ------------------------------------------------

export function parseConceptIds(files: readonly InputFile[], options: ParseOptions): ParseResult {
  const { cells } = readCells(firstTabular(files), options)
  const skip = Math.max(0, options.skipRows ?? 0)
  const first = cells[skip]?.[0]
  const hasHeader = options.hasHeader ?? (first !== undefined && parseId(first) === null)
  const table = tableFromCells(cells, { ...options, hasHeader })
  const column = options.columns?.targetConceptId
  const index = column ? table.headers.indexOf(column) : 0
  if (index < 0) throw new MappingImportError('missing_columns', column ?? null)
  const sink = new RowSink()
  table.rows.forEach((r, i) => {
    sink.read()
    const t = parseTargets(r[index])
    if (t.ids.length === 0) sink.skip(t.invalid ? 'invalid_target' : 'blank_row', i + 1)
    else {
      if (t.invalid) sink.warn('invalid_target', i + 1)
      sink.add({}, t.ids)
    }
  })
  return sink.result('concept_ids')
}

// --- OMOP source_to_concept_map (and Linkr's variant with source_domain_id) --------------

export function parseStcm(table: Table): ParseResult {
  const h = table.headers
  const cols = {
    source_code: findColumn(h, 'source_code'),
    target_concept_id: findColumn(h, 'target_concept_id'),
  }
  requireColumns(cols)
  const conceptId = findColumn(h, 'source_concept_id')
  const vocabulary = findColumn(h, 'source_vocabulary_id')
  const description = findColumn(h, 'source_code_description')
  const invalid = findColumn(h, 'invalid_reason')
  const sink = new RowSink()
  table.rows.forEach((r, i) => {
    sink.read()
    if (text(cell(r, invalid)) !== undefined) return sink.skip('invalid_mapping', i + 1)
    const source: Source = {
      sourceVocabularyId: text(cell(r, vocabulary)),
      sourceCode: text(cell(r, cols.source_code)),
      sourceName: text(cell(r, description)),
      sourceConceptId: sourceId(cell(r, conceptId)),
    }
    addOrBlank(sink, source, cell(r, cols.target_concept_id), i + 1)
  })
  return sink.result('stcm')
}

// --- Usagi ---------------------------------------------------------------------------------

export function parseUsagi(table: Table): ParseResult {
  const h = table.headers
  const cols = { sourceCode: findColumn(h, 'sourceCode'), conceptId: findColumn(h, 'conceptId') }
  requireColumns(cols)
  const name = findColumn(h, 'sourceName')
  const frequency = findColumn(h, 'sourceFrequency')
  const mappingStatus = findColumn(h, 'mappingStatus')
  const equiv = findColumn(h, 'equivalence')
  const sink = new RowSink()
  table.rows.forEach((r, i) => {
    sink.read()
    const source: Source = {
      sourceCode: text(cell(r, cols.sourceCode)),
      sourceName: text(cell(r, name)),
      equivalence: equivalence(cell(r, equiv)),
      status: status(cell(r, mappingStatus)),
      frequency: parseFrequency(cell(r, frequency)),
    }
    addOrBlank(sink, source, cell(r, cols.conceptId), i + 1)
  })
  return sink.result('usagi', ['approved'])
}

// --- CONCEPT + CONCEPT_RELATIONSHIP ---------------------------------------------------------

const MAPS_TO = new Set(['maps to', 'maps to value'])

function tableKind(file: InputFile, table: Table): 'concept' | 'relationship' | null {
  const base = (file.name.split('/').pop() ?? '').slice(0, -extensionOf(file.name).length || undefined).toLowerCase()
  if (base === 'concept_relationship') return 'relationship'
  if (base === 'concept') return 'concept'
  if (findColumn(table.headers, 'concept_id_1') >= 0 && findColumn(table.headers, 'concept_id_2') >= 0) return 'relationship'
  if (findColumn(table.headers, 'concept_id') >= 0 && findColumn(table.headers, 'concept_code') >= 0) return 'concept'
  return null
}

export function ccrTables(files: readonly InputFile[], options: ParseOptions): { concept: Table | null; relationship: Table | null } {
  let concept: Table | null = null
  let relationship: Table | null = null
  for (const file of files) {
    if (!isTabular(file)) continue
    const table = readTable(file, { ...options, hasHeader: true, skipRows: 0 })
    const kind = tableKind(file, table)
    if (kind === 'concept' && !concept) concept = table
    else if (kind === 'relationship' && !relationship) relationship = table
  }
  return { concept, relationship }
}

export function parseCcr(files: readonly InputFile[], options: ParseOptions): ParseResult {
  const { concept, relationship } = ccrTables(files, options)
  if (!relationship) throw new MappingImportError('missing_file', 'CONCEPT_RELATIONSHIP')
  const rh = relationship.headers
  const rc = {
    concept_id_1: findColumn(rh, 'concept_id_1'),
    concept_id_2: findColumn(rh, 'concept_id_2'),
    relationship_id: findColumn(rh, 'relationship_id'),
  }
  requireColumns(rc)
  const rInvalid = findColumn(rh, 'invalid_reason')
  const sink = new RowSink()

  // Source concepts, in file order (only when CONCEPT is given).
  const sources = new Map<number, Source>()
  const order: number[] = []
  if (concept) {
    const ch = concept.headers
    const cc = { concept_id: findColumn(ch, 'concept_id') }
    requireColumns(cc)
    const code = findColumn(ch, 'concept_code')
    const vocabulary = findColumn(ch, 'vocabulary_id')
    const name = findColumn(ch, 'concept_name')
    const invalid = findColumn(ch, 'invalid_reason')
    concept.rows.forEach((r, i) => {
      sink.read()
      const id = parseId(cell(r, cc.concept_id))
      if (!id || text(cell(r, invalid)) !== undefined) return sink.skip('invalid_concept', i + 1)
      if (sources.has(id)) return
      sources.set(id, {
        sourceVocabularyId: text(cell(r, vocabulary)),
        sourceCode: text(cell(r, code)),
        sourceName: text(cell(r, name)),
        sourceConceptId: id,
      })
      order.push(id)
    })
  }

  // Targets per source concept, in relationship order.
  const targets = new Map<number, number[]>()
  relationship.rows.forEach((r, i) => {
    const rel = clean(cell(r, rc.relationship_id) ?? '').toLowerCase()
    if (!MAPS_TO.has(rel)) return
    const from = parseId(cell(r, rc.concept_id_1))
    if (concept && (from === null || !sources.has(from))) return
    sink.read()
    if (text(cell(r, rInvalid)) !== undefined) return sink.skip('invalid_mapping', i + 1)
    const to = parseId(cell(r, rc.concept_id_2))
    if (!from || !to) return sink.skip('invalid_target', i + 1)
    const list = targets.get(from)
    if (!list) {
      targets.set(from, [to])
      if (!concept) order.push(from)
    } else if (!list.includes(to)) list.push(to)
  })

  for (const id of order) sink.add(sources.get(id) ?? { sourceConceptId: id }, targets.get(id) ?? [])
  return sink.result('ccr')
}

// --- SSSOM TSV ------------------------------------------------------------------------------

const OMOP_PREFIXES = ['ohdsi', 'omop', 'athena']
const OMOP_BASES = ['https://athena.ohdsi.org/search-terms/terms/']

export interface SssomMetadata {
  curieMap: Record<string, string>
  title: string | null
}

function unquote(value: string): string {
  const v = clean(value)
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] ? v.slice(1, -1) : v
}

/** The `#` YAML block: `curie_map` entries and `mapping_set_title`, read line by line (no YAML library). */
export function sssomMetadata(lines: readonly string[]): SssomMetadata {
  const curieMap: Record<string, string> = {}
  let title: string | null = null
  let inCurieMap = false
  for (const raw of lines) {
    const line = raw.replace(/^#/, '')
    const nested = /^[ \t]+([^:\s]+)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (inCurieMap && nested) {
      curieMap[nested[1]] = unquote(nested[2])
      continue
    }
    inCurieMap = false
    const top = /^([^:\s]+)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (!top) continue
    if (top[1] === 'curie_map') inCurieMap = clean(top[2]) === ''
    else if (top[1] === 'mapping_set_title') title = unquote(top[2]) || null
  }
  return { curieMap, title }
}

type SssomObject = { kind: 'id'; id: number } | { kind: 'unmapped' } | { kind: 'invalid' } | { kind: 'foreign' }

export function sssomObject(objectId: string, meta: SssomMetadata): SssomObject {
  const value = clean(objectId)
  if (value === '' || value.toLowerCase() === 'sssom:notermfound') return { kind: 'unmapped' }
  const prefixes = new Set(OMOP_PREFIXES)
  const bases = [...OMOP_BASES]
  for (const [prefix, uri] of Object.entries(meta.curieMap)) {
    const u = uri.toLowerCase()
    if (u.includes('ohdsi') || u.includes('omop')) {
      prefixes.add(prefix.toLowerCase())
      bases.push(uri)
    }
  }
  let local: string | null = null
  if (/^https?:\/\//i.test(value)) {
    const base = bases.find((b) => value.startsWith(b))
    if (base) local = value.slice(base.length)
  } else {
    const colon = value.indexOf(':')
    if (colon > 0 && prefixes.has(value.slice(0, colon).toLowerCase())) local = value.slice(colon + 1)
  }
  if (local === null) return { kind: 'foreign' }
  const id = parseId(local)
  if (id === null) return { kind: 'invalid' }
  return id === 0 ? { kind: 'unmapped' } : { kind: 'id', id }
}

export function splitSssom(content: string): { metadata: string[]; body: string } {
  const lines = content.split(/\r\n|\n|\r/)
  let n = 0
  while (n < lines.length && lines[n].startsWith('#')) n++
  return { metadata: lines.slice(0, n), body: lines.slice(n).join('\n') }
}

export function parseSssom(files: readonly InputFile[], options: ParseOptions): ParseResult {
  const file = firstTabular(files)
  const { metadata, body } = splitSssom(decode(file.data, options.encoding))
  const meta = sssomMetadata(metadata)
  const { headers, rows } = tableFromCells(parseDelimited(body, '\t'))
  const cols = { subject_id: findColumn(headers, 'subject_id'), object_id: findColumn(headers, 'object_id') }
  requireColumns(cols)
  const label = findColumn(headers, 'subject_label')
  const subjectSource = findColumn(headers, 'subject_source')
  const predicate = findColumn(headers, 'predicate_id')
  const modifier = findColumn(headers, 'predicate_modifier')
  const sink = new RowSink()
  rows.forEach((r, i) => {
    sink.read()
    if (clean(cell(r, modifier) ?? '').toLowerCase() === 'not') return sink.skip('negated', i + 1)
    const subject = clean(cell(r, cols.subject_id) ?? '')
    const colon = subject.indexOf(':')
    const curie = colon > 0 && !/^https?:\/\//i.test(subject)
    const source: Source = {
      sourceVocabularyId: curie ? subject.slice(0, colon) : text(cell(r, subjectSource)),
      sourceCode: text(curie ? subject.slice(colon + 1) : subject),
      sourceName: text(cell(r, label)),
      equivalence: text(cell(r, predicate)),
    }
    const object = sssomObject(cell(r, cols.object_id) ?? '', meta)
    if (object.kind === 'foreign') return sink.skip('non_omop_object', i + 1)
    if (object.kind === 'invalid') return sink.skip('invalid_target', i + 1)
    if (object.kind === 'unmapped' && !hasSource(source)) return sink.skip('blank_row', i + 1)
    sink.add(source, object.kind === 'id' ? [object.id] : [])
  })
  return sink.result('sssom', null, meta.title)
}

// --- Linkr mapping project (folder / ZIP: entity.json + mappings.json; or its JSON export) --

function parseJson(file: InputFile): unknown {
  try {
    return JSON.parse(decode(file.data, 'utf-8'))
  } catch {
    throw new MappingImportError('invalid_json', file.name)
  }
}

function dirOf(name: string): string {
  const i = name.lastIndexOf('/')
  return i >= 0 ? name.slice(0, i + 1) : ''
}

function localizedName(value: unknown): string | null {
  if (typeof value === 'string') return text(value) ?? null
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const pick = typeof obj.en === 'string' ? obj.en : Object.values(obj).find((v) => typeof v === 'string')
    return typeof pick === 'string' ? (text(pick) ?? null) : null
  }
  return null
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseLinkr(files: readonly InputFile[]): ParseResult {
  const json = files.filter((f) => extensionOf(f.name) === '.json').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const lists: unknown[][] = []
  let name: string | null = null
  for (const file of json) {
    const base = file.name.split('/').pop()
    if (base === 'mappings.json') {
      const data = parseJson(file)
      if (!Array.isArray(data)) throw new MappingImportError('invalid_json', file.name)
      lists.push(data)
      const entity = json.find((f) => f.name === `${dirOf(file.name)}entity.json`)
      if (entity && name === null) {
        const e = parseJson(entity)
        if (isObject(e)) name = localizedName(e.name)
      }
    } else if (base !== 'entity.json') {
      const data = parseJson(file)
      if (isObject(data) && data.exportFormat === 'linkr-concept-mapping' && Array.isArray(data.mappings)) {
        lists.push(data.mappings)
        if (name === null && isObject(data.project)) name = localizedName(data.project.name)
      }
    }
  }
  if (lists.length === 0) throw new MappingImportError('missing_file', 'mappings.json')
  const sink = new RowSink()
  let n = 0
  for (const list of lists) {
    for (const m of list) {
      n++
      sink.read()
      if (!isObject(m)) {
        sink.skip('invalid_mapping', n)
        continue
      }
      const source: Source = {
        sourceVocabularyId: text(m.sourceVocabularyId),
        sourceCode: text(m.sourceConceptCode),
        sourceName: text(m.sourceConceptName),
        sourceConceptId: sourceId(m.sourceConceptId),
        equivalence: equivalence(m.equivalence),
        status: status(m.status),
        frequency: parseFrequency(m.sourceFrequency),
      }
      const target = m.targetConceptId
      if (target == null || target === '') sink.add(source, [])
      else sink.addCell(source, typeof target === 'number' || typeof target === 'string' ? target : false, n)
    }
  }
  return sink.result('linkr', ['approved'], name)
}
