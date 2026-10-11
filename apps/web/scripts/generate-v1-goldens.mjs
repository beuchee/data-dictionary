#!/usr/bin/env node
/**
 * Golden outputs of the v1 exports, produced by running v1's own code.
 *
 * Loads `legacy/app.js` (the real `App`) and the export sections of
 * `legacy/concept-sets.js` and `legacy/projects.js` in a `vm` sandbox with a
 * minimal DOM stub, feeds them the real content of this repo, and writes what
 * they produce to `src/lib/export/__fixtures__/v1/`. The v2 ports in
 * `src/lib/export/` are tested for byte-equality against those files.
 *
 * Fixed inputs so the output is stable: date 2026-01-15, site at
 * https://indicate-eu.github.io/data-dictionary/, no vocabulary database (unit
 * labels come from units/*.json, as in v1 without DuckDB), empty localStorage.
 * Pinned project versions are read with `git show <sha>:concept_sets/{id}.json`
 * from concept_sets_versions.json, standing in for v1's browser fetch.
 *
 * Usage (from the repo root or apps/web): node apps/web/scripts/generate-v1-goldens.mjs
 * Rerun only on purpose: the goldens pin v1's behaviour, they are not meant to
 * follow content changes. The tests read the content these goldens were made
 * from out of `inputs/`, so a content edit never breaks them.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const OUT = path.resolve(HERE, '../src/lib/export/__fixtures__/v1')

const FIXED_DATE = '2026-01-15T12:00:00.000Z'
const SITE = { origin: 'https://indicate-eu.github.io', pathname: '/data-dictionary/' }

/** SQL cases: concept set id → why it is here. */
const SQL_SETS = {
  155: 'ionized calcium: mmol/L vs mg/dL, Classification concepts in the resolved list',
  149: 'a reference unit with no conversion registered',
  184: 'affine offset conversions',
  330: 'body temperature: affine offsets (Celsius/Fahrenheit)',
  318: 'multi-domain: Measurement + Observation',
  305: 'mixed: Procedure + Observation + a domain without CDM table (Meas Value)',
  163: 'domain without CDM table only (Specimen)',
  37: 'drug set',
  17: 'condition set',
  99999: 'synthetic: no resolved concepts',
  99998: 'synthetic: contradictory factors for one source unit (per-concept CASE)',
}
const ATLAS_SETS = [1, 155, 171, 172, 305, 37, 99999]
const INDICATE_SETS = [1, 155, 330, 99999]

// --- Content ---------------------------------------------------------------

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'))
const listIds = (dir) =>
  fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => Number(f.slice(0, -5)))
    .sort((a, b) => a - b)

const conceptSets = listIds('concept_sets').map((id) => readJson(`concept_sets/${id}.json`))
const projects = listIds('projects').map((id) => readJson(`projects/${id}.json`))
const resolvedById = new Map()
for (const id of listIds('concept_sets_resolved')) resolvedById.set(id, readJson(`concept_sets_resolved/${id}.json`))
const unitConversions = readJson('units/unit_conversions.json')
const recommendedUnits = readJson('units/recommended_units.json')
const versionsIndex = readJson('concept_sets_versions.json')
const config = readJson('config.json')

// A legacy-shaped set: flat organization, no sourceRepo, no resolved list.
const synthetic = JSON.parse(JSON.stringify(conceptSets.find((cs) => cs.id === 1)))
synthetic.id = 99999
synthetic.version = '0.1.0'
synthetic.metadata.organization = { name: 'Legacy Org', url: 'https://legacy.example.org' }
delete synthetic.metadata.sourceRepo
conceptSets.push(synthetic)
const pristine = new Map([[99999, JSON.stringify(synthetic, null, 2)]])

// Contradictory factors for one (source → reference) pair: no real set has them,
// so v1's per-concept CASE would go untested. Made-up concept ids, so no real
// set's output moves.
const ambiguous = JSON.parse(JSON.stringify(conceptSets.find((cs) => cs.id === 155)))
ambiguous.id = 99998
ambiguous.version = '0.1.0'
conceptSets.push(ambiguous)
pristine.set(99998, JSON.stringify(ambiguous, null, 2))
const fakeConcept = (conceptId, conceptName, domainId = 'Measurement') => ({
  conceptId, conceptName, vocabularyId: 'LOINC', domainId, conceptClassId: 'Lab Test', conceptCode: `X-${conceptId}`, standardConcept: 'S',
})
resolvedById.set(99998, {
  conceptSetId: 99998,
  vocabularyVersion: null,
  resolvedConcepts: [
    fakeConcept(990001, 'Analyte A in serum'),
    fakeConcept(990002, 'Analyte A in plasma'),
    fakeConcept(990003, 'Analyte A in urine'),
    fakeConcept(990004, 'Analyte A, no conversion'),
    fakeConcept(990005, 'Analyte A observed', 'Observation'),
  ],
})
const fakeConversion = (conceptId, sourceUnitConceptId, sourceUnitCode, conversionFactor, offset) => ({
  conceptId, conceptName: `concept ${conceptId}`, sourceUnitConceptId, sourceUnitCode, sourceUnitName: '', conversionFactor,
  ...(offset === undefined ? {} : { offset }),
  targetUnitConceptId: 8753, targetUnitCode: 'mmol/L', targetUnitName: 'millimole per liter',
})
unitConversions.push(
  fakeConversion(990001, 8840, 'mg/dL', 0.25),
  fakeConversion(990002, 8840, 'mg/dL', 0.25),
  fakeConversion(990001, 8636, 'g/L', 2.5),
  fakeConversion(990002, 8636, 'g/L', 2.5),
  fakeConversion(990003, 8840, 'mg/dL', 0.1, -1.5),
)
for (const conceptId of [990001, 990002, 990003, 990004]) {
  recommendedUnits.push({
    conceptId, conceptName: `concept ${conceptId}`, conceptCode: `X-${conceptId}`, vocabularyId: 'LOINC', domainId: 'Measurement',
    recommendedUnitConceptId: 8753, recommendedUnitName: 'millimole per liter', recommendedUnitCode: 'mmol/L', recommendedUnitVocabularyId: 'UCUM',
  })
}

// Past versions pinned by projects, as v1 would have fetched them.
const pinnedVersions = {}
const currentVersion = new Map(conceptSets.map((cs) => [cs.id, cs.version]))
for (const p of projects) {
  for (const g of p.groups || []) {
    for (const e of g.conceptSets || []) {
      if (!e.version || e.version === currentVersion.get(e.id)) continue
      const sha = (versionsIndex[String(e.id)] || {})[e.version]
      if (!sha) continue
      let text
      try {
        text = execFileSync('git', ['show', `${sha}:concept_sets/${e.id}.json`], { cwd: ROOT, encoding: 'utf-8', maxBuffer: 64 << 20 })
      } catch {
        continue
      }
      ;(pinnedVersions[String(e.id)] ??= {})[e.version] = JSON.parse(text)
    }
  }
}

const DATA = {
  config,
  conceptSets,
  projects,
  resolvedConceptSets: [...resolvedById.values()],
  conceptSetVersions: pinnedVersions,
  resolvedConceptSetVersions: {},
  conceptSetVersionsIndex: versionsIndex,
  unitConversions,
  recommendedUnits,
  mappingRecommendations: {},
}

// --- Sandbox ---------------------------------------------------------------

function fakeElement() {
  const el = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    checked: false,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    setAttribute() {},
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    click() {},
  }
  return el
}

const elements = new Map()
const createdLinks = []
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, fakeElement())
    return elements.get(id)
  },
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  createElement() {
    const el = fakeElement()
    createdLinks.push(el)
    return el
  },
  addEventListener() {},
  body: fakeElement(),
  documentElement: fakeElement(),
}

const storage = new Map()
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}

let editorValue = ''
const ace = {
  edit: () => ({
    setTheme() {},
    setFontSize() {},
    setShowPrintMargin() {},
    setReadOnly() {},
    renderer: { setShowGutter() {} },
    session: { setUseWrapMode() {}, setMode() {} },
    setValue(v) { editorValue = v },
    getValue: () => editorValue,
    resize() {},
  }),
}

let blobText = null
class Blob {
  constructor(parts) { blobText = parts.join('') }
}

const sandbox = {
  console,
  DATA,
  document,
  localStorage,
  ace,
  Blob,
  URL: { createObjectURL: () => 'blob:golden', revokeObjectURL() {} },
  navigator: {},
  location: { ...SITE, hash: '', search: '', href: SITE.origin + SITE.pathname },
  setTimeout: () => 0,
  clearTimeout() {},
  requestAnimationFrame: () => 0,
}
sandbox.window = sandbox
vm.createContext(sandbox)

vm.runInContext(`
  var __RealDate = Date;
  Date = class extends __RealDate {
    constructor(...a) { if (a.length === 0) super(${JSON.stringify(FIXED_DATE)}); else super(...a); }
    static now() { return new __RealDate(${JSON.stringify(FIXED_DATE)}).getTime(); }
  };
`, sandbox)

const legacy = (f) => fs.readFileSync(path.join(ROOT, 'legacy', f), 'utf-8')
vm.runInContext(legacy('app.js') + '\n;this.App = App;', sandbox, { filename: 'legacy/app.js' })
const App = sandbox.App
App.loadData()

/** The source between two markers of a legacy file, failing loudly if they moved. */
function slice(file, startMarker, endMarker) {
  const src = legacy(file)
  const start = src.indexOf(startMarker)
  const end = src.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error(`markers not found in legacy/${file}: ${startMarker} … ${endMarker}`)
  return src.slice(start, end)
}

const CS = vm.runInContext(`(function() {
  var selectedConceptSet = null;
  var selectedSnapshotVersion = null;
  var resolvedCurrentConcepts = [];
  var sqlExportUnitLabels = {};
  function resolvedForCurrentView() { return null; }
  ${slice('concept-sets.js', '  var exportMethod = null;', "  // `format` is 'indicate' or 'atlas'")}
  return {
    select: function(cs) { selectedConceptSet = cs; sqlExportUnitLabels = {}; },
    showSqlExportPreview: showSqlExportPreview,
    buildOMOPSQL: buildOMOPSQL,
    buildAtlasJSON: buildAtlasJSON,
    buildIndicateJSON: buildIndicateJSON,
    unitLabels: function() { return sqlExportUnitLabels; },
  };
})()`, sandbox, { filename: 'legacy/concept-sets.js (export section)' })

const PROJ = vm.runInContext(`(function() {
  var selectedProject = null;
  ${slice('projects.js', '    function csvField(v) {', '    // Project JSON export')}
  return {
    select: function(p) { selectedProject = p; },
    exportProjectCSV: exportProjectCSV,
  };
})()`, sandbox, { filename: 'legacy/projects.js (CSV export)' })

// --- Generation --------------------------------------------------------------

fs.rmSync(OUT, { recursive: true, force: true })
const write = (rel, text) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const inputs = { conceptSets: new Set(), resolved: new Set() }

const conceptSetById = (id) => App.conceptSets.find((cs) => cs.id === id)
const setLang = (lang) => { App.lang = lang }
const setDrop = (on) => localStorage.setItem('indicate_sql_drop_other_units', on ? '1' : '0')

/** Runs v1's SQL dialog flow; returns the default SQL and the unit picker it showed. */
function openSqlDialog(cs) {
  CS.select(cs)
  editorValue = ''
  CS.showSqlExportPreview()
  const select = document.getElementById('export-sql-unit-select')
  const options = [...select.innerHTML.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)]
    .map((m) => ({ unitId: Number(m[1]), label: m[2] }))
  return { sql: editorValue, options, selected: options.length ? Number(select.value) : null }
}

const sqlCases = []
for (const [idStr, why] of Object.entries(SQL_SETS)) {
  const id = Number(idStr)
  const cs = conceptSetById(id)
  inputs.conceptSets.add(id)
  if (resolvedById.has(id)) inputs.resolved.add(id)
  for (const lang of id === 155 ? ['en', 'fr'] : ['en']) {
    setLang(lang)
    for (const drop of [false, true]) {
      setDrop(drop)
      const dialog = openSqlDialog(cs)
      const base = `${id}-${lang}-default${drop ? '-drop' : ''}`
      write(`sql/${base}.sql`, dialog.sql)
      sqlCases.push({ conceptSetId: id, why, lang, dropOtherUnits: drop, referenceUnitId: dialog.selected, isDefault: true, unitOptions: dialog.options, file: `sql/${base}.sql` })
      if (lang !== 'en') continue
      // Every other unit of the picker, then no unit at all (v1's "no reference unit" path).
      for (const opt of dialog.options) {
        if (opt.unitId === dialog.selected) continue
        const file = `sql/${id}-${lang}-unit-${opt.unitId}${drop ? '-drop' : ''}.sql`
        write(file, CS.buildOMOPSQL(opt.unitId))
        sqlCases.push({ conceptSetId: id, why, lang, dropOtherUnits: drop, referenceUnitId: opt.unitId, isDefault: false, unitOptions: dialog.options, file })
      }
      if (dialog.options.length && !drop) {
        const file = `sql/${id}-${lang}-no-unit.sql`
        write(file, CS.buildOMOPSQL(null))
        sqlCases.push({ conceptSetId: id, why, lang, dropOtherUnits: drop, referenceUnitId: null, isDefault: false, unitOptions: dialog.options, file })
      }
    }
  }
}
setLang('en')
setDrop(false)

const atlasCases = ATLAS_SETS.map((id) => {
  inputs.conceptSets.add(id)
  CS.select(conceptSetById(id))
  write(`atlas/${id}.json`, CS.buildAtlasJSON())
  return { conceptSetId: id, file: `atlas/${id}.json` }
})

const indicateCases = []
for (const id of INDICATE_SETS) {
  inputs.conceptSets.add(id)
  for (const profile of [null, { firstName: 'Ada', lastName: 'Lovelace' }]) {
    if (profile) localStorage.setItem('indicate_reviewer', JSON.stringify(profile))
    else localStorage.removeItem('indicate_reviewer')
    // buildIndicateJSON stamps a deep copy, but normalizeConceptSetMeta ran on load:
    // the copy is the normalized set, which is what v1 exported.
    CS.select(conceptSetById(id))
    const file = `indicate/${id}${profile ? '-profile' : ''}.json`
    write(file, CS.buildIndicateJSON())
    indicateCases.push({ conceptSetId: id, modifiedBy: profile ? `${profile.firstName} ${profile.lastName}` : null, file })
  }
}
localStorage.removeItem('indicate_reviewer')

const csvCases = []
for (const p of App.projects) {
  // One French export is enough to pin the language handling; the rest stay small.
  for (const lang of p.id === 5 ? ['en', 'fr'] : ['en']) {
    setLang(lang)
    PROJ.select(p)
    blobText = null
    createdLinks.length = 0
    PROJ.exportProjectCSV()
    const file = `project-csv/${p.id}-${lang}.csv`
    write(file, blobText)
    csvCases.push({ projectId: p.id, lang, filename: createdLinks.at(-1).download, file })
  }
}
setLang('en')

// The exact inputs, so the goldens keep testing v1 parity after the content moves on.
const pinned = []
for (const [id, byVersion] of Object.entries(pinnedVersions)) {
  for (const [version, cs] of Object.entries(byVersion)) {
    pinned.push({ id: Number(id), version })
    write(`inputs/pinned/${id}@${version}.json`, JSON.stringify(cs, null, 2) + '\n')
  }
}
for (const id of inputs.conceptSets) {
  // Synthetic sets as written, before App.loadData normalized them in place.
  const text = pristine.get(id) ?? JSON.stringify(readJson(`concept_sets/${id}.json`), null, 2)
  write(`inputs/concept_sets/${id}.json`, text + '\n')
}
for (const id of inputs.resolved) write(`inputs/concept_sets_resolved/${id}.json`, JSON.stringify(resolvedById.get(id)))
for (const p of projects) {
  for (const g of p.groups || []) for (const e of g.conceptSets || []) {
    if (e.version !== currentVersion.get(e.id) || inputs.conceptSets.has(e.id)) continue
    inputs.conceptSets.add(e.id)
    write(`inputs/concept_sets/${e.id}.json`, JSON.stringify(readJson(`concept_sets/${e.id}.json`), null, 2) + '\n')
  }
  write(`inputs/projects/${p.id}.json`, JSON.stringify(p, null, 2) + '\n')
}

// Units: the rows of the SQL cases' concepts, plus, for every unit they mention,
// the first row elsewhere that labels it (v1 takes a unit's label from the first
// row naming it, whatever its concept), in file order.
const sqlConceptIds = new Set()
for (const { conceptSetId } of sqlCases) {
  for (const c of resolvedById.get(conceptSetId)?.resolvedConcepts ?? []) sqlConceptIds.add(c.conceptId)
}
const keepConv = new Set(unitConversions.filter((u) => sqlConceptIds.has(u.conceptId)))
const keepRec = new Set(recommendedUnits.filter((u) => sqlConceptIds.has(u.conceptId)))
const unitIds = new Set()
for (const u of keepConv) unitIds.add(u.sourceUnitConceptId).add(u.targetUnitConceptId)
for (const u of keepRec) unitIds.add(u.recommendedUnitConceptId)
for (const id of unitIds) {
  const conv = unitConversions.find((u) =>
    (u.sourceUnitConceptId === id && (u.sourceUnitCode || u.sourceUnitName)) ||
    (u.targetUnitConceptId === id && (u.targetUnitCode || u.targetUnitName)))
  if (conv) keepConv.add(conv)
  const rec = recommendedUnits.find((u) => u.recommendedUnitConceptId === id && (u.recommendedUnitCode || u.recommendedUnitName))
  if (rec) keepRec.add(rec)
}
write('inputs/unit_conversions.json', JSON.stringify(unitConversions.filter((u) => keepConv.has(u)), null, 2) + '\n')
write('inputs/recommended_units.json', JSON.stringify(recommendedUnits.filter((u) => keepRec.has(u)), null, 2) + '\n')

write('cases.json', JSON.stringify({
  generatedFrom: 'legacy/ (v1 ' + App.APP_VERSION + ')',
  date: FIXED_DATE.slice(0, 10),
  siteBase: SITE.origin + SITE.pathname,
  toolTag: App.toolTag(),
  repoUrl: config.repository.url,
  sql: sqlCases,
  atlas: atlasCases,
  indicate: indicateCases,
  projectCsv: csvCases,
  pinned,
}, null, 2) + '\n')

console.log(`v1 goldens → ${path.relative(ROOT, OUT)}: ${sqlCases.length} SQL, ${atlasCases.length} ATLAS, ${indicateCases.length} INDICATE, ${csvCases.length} CSV`)
