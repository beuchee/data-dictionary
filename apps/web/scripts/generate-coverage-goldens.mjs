#!/usr/bin/env node
/**
 * Golden results for `src/lib/coverage/` from the v1 eligibility engine.
 *
 * Runs v1's own functions (`legacy/app.js`: getProjectGroups, getResolvedConceptSet,
 * getLatestVersion, GROUP_RULES; `legacy/mapping.js`: buildMappedSet,
 * evaluateProject, evaluateAllProjects), extracted from the source text and
 * evaluated in a Node `vm` context, on the real projects plus synthetic edge-case
 * projects and a few synthetic mapped-id sets. Resolved lists come from
 * `concept_sets_resolved/` (current versions) and from git at the commit indexed in
 * `concept_sets_versions.json` (pinned past versions), as v1 fetches them.
 *
 * Writes `src/lib/coverage/__fixtures__/v1/{inputs,results}.json`. The inputs keep,
 * for each pinned (id, version), only the size of its resolved list and the ids
 * that some mapped set contains: that is all the evaluation depends on, and it
 * keeps the fixture small and independent of later content edits.
 *
 * Usage (from the repo root or apps/web): node apps/web/scripts/generate-coverage-goldens.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const outDir = path.resolve(here, '../src/lib/coverage/__fixtures__/v1')

const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'))

// --- Extract v1 functions from the source text ---------------------------------

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`function ${name} not found`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

function extractVar(source, name) {
  const m = new RegExp(`var ${name} = [^;]+;`).exec(source)
  if (!m) throw new Error(`var ${name} not found`)
  return m[0]
}

const appJs = readFileSync(path.join(root, 'legacy/app.js'), 'utf8')
const mappingJs = readFileSync(path.join(root, 'legacy/mapping.js'), 'utf8')

const v1Source = [
  extractVar(appJs, 'GROUP_RULES'),
  extractVar(appJs, 'DEFAULT_GROUP_RULE'),
  extractFunction(appJs, 'getProjectGroups'),
  extractFunction(appJs, 'getGroupName'),
  extractFunction(appJs, 'getConceptSet'),
  extractFunction(appJs, 'getResolvedConceptSet'),
  extractFunction(appJs, 'getLatestVersion'),
  `var App = {
     getProjectGroups: getProjectGroups, getGroupName: getGroupName,
     getConceptSet: getConceptSet, getResolvedConceptSet: getResolvedConceptSet,
     getLatestVersion: getLatestVersion, GROUP_RULES: GROUP_RULES,
     DEFAULT_GROUP_RULE: DEFAULT_GROUP_RULE, projects: projects
   };`,
  extractFunction(mappingJs, 'buildMappedSet'),
  extractFunction(mappingJs, 'evaluateProject'),
  extractFunction(mappingJs, 'evaluateAllProjects'),
].join('\n\n')

// --- Real content -------------------------------------------------------------

const conceptSets = readdirSync(path.join(root, 'concept_sets'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(`concept_sets/${f}`))
const currentVersions = Object.fromEntries(conceptSets.map((cs) => [cs.id, cs.version]))

const resolvedIndex = {}
for (const f of readdirSync(path.join(root, 'concept_sets_resolved'))) {
  if (!f.endsWith('.json')) continue
  const r = readJson(`concept_sets_resolved/${f}`)
  resolvedIndex[r.conceptSetId] = r.resolvedConcepts || []
}

const versionsIndex = readJson('concept_sets_versions.json')
const realProjects = readdirSync(path.join(root, 'projects'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(`projects/${f}`))
  .sort((a, b) => a.id - b.id)

/** Only what the evaluation reads: ids, groups (rule, entries), legacy shapes. */
function skeleton(project) {
  const out = { id: project.id }
  if (Array.isArray(project.groups)) {
    out.groups = project.groups.map((g) => {
      const group = { id: g.id, conceptSets: g.conceptSets }
      if (g.rule !== undefined) group.rule = g.rule
      return group
    })
  }
  if (Array.isArray(project.conceptSets)) out.conceptSets = project.conceptSets
  if (Array.isArray(project.conceptSetIds)) out.conceptSetIds = project.conceptSetIds
  return out
}

// --- Synthetic edge cases -----------------------------------------------------

const UNKNOWN_ID = 999999
const p5 = realProjects.find((p) => p.id === 5)
const p2 = realProjects.find((p) => p.id === 2)
const someIds = p2.groups[0].conceptSets.slice(0, 6).map((e) => e.id)
const pick = (n, offset = 0) =>
  p2.groups[0].conceptSets.slice(offset, offset + n).map((e) => ({ id: e.id, version: e.version }))

const syntheticProjects = [
  // Legacy flat `conceptSets` → one default all_required group.
  { id: 101, conceptSets: p5.groups[1].conceptSets },
  // Oldest legacy `conceptSetIds` → read at their latest version; one unknown id.
  { id: 102, conceptSetIds: [...someIds, UNKNOWN_ID] },
  {
    id: 103,
    groups: [
      { id: 'empty', rule: 'all_required', conceptSets: [] },
      { id: 'no-rule', conceptSets: pick(2, 10) },
      {
        id: 'unknown-and-missing',
        rule: 'at_least_one',
        conceptSets: [
          { id: UNKNOWN_ID, version: '1.0.0' },
          { id: someIds[0], version: '9.9.9' },
        ],
      },
      { id: 'optional', rule: 'optional', conceptSets: pick(3, 20) },
    ],
  },
  {
    id: 104,
    groups: [
      { id: 'opt-a', rule: 'optional', conceptSets: pick(4, 30) },
      { id: 'opt-b', rule: 'optional', conceptSets: pick(2, 40) },
    ],
  },
  { id: 105, groups: [] },
  {
    id: 106,
    groups: [
      { id: 'empty-alo', rule: 'at_least_one', conceptSets: [] },
      { id: 'opt-empty', rule: 'optional', conceptSets: [] },
      { id: 'alo', rule: 'at_least_one', conceptSets: pick(3, 50) },
    ],
  },
]

const projects = [...realProjects.map(skeleton), ...syntheticProjects]

// --- Pinned past versions, as v1 fetches them (raw file at the indexed commit) ---

const fetchedVersions = {}
function gitShow(sha, file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${sha}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }))
  } catch {
    return null
  }
}

function pinnedEntries(project) {
  if (Array.isArray(project.groups)) return project.groups.flatMap((g) => g.conceptSets || [])
  if (Array.isArray(project.conceptSets)) return project.conceptSets
  if (Array.isArray(project.conceptSetIds)) return project.conceptSetIds.map((id) => ({ id, version: currentVersions[id] || '' }))
  return []
}

const pairs = new Map()
for (const p of projects) for (const e of pinnedEntries(p)) pairs.set(`${e.id}@${e.version}`, e)

for (const { id, version } of pairs.values()) {
  if (!version || currentVersions[id] === version) continue
  const sha = versionsIndex[String(id)]?.[version]
  if (!sha) continue
  const resolved = gitShow(sha, `concept_sets_resolved/${id}.json`)
  fetchedVersions[`${id}@${version}`] = { cs: null, resolved: resolved ? resolved.resolvedConcepts || [] : null }
}

// --- Run v1 ---------------------------------------------------------------------

const context = vm.createContext({
  conceptSets,
  resolvedIndex,
  DATA: { conceptSetVersions: {}, resolvedConceptSetVersions: {} },
  fetchedVersions,
  lang: 'en',
  projects,
  Set,
  Math,
})
vm.runInContext(v1Source, context)

/** The resolved ids v1 sees for an entry (empty when it sees none). */
const resolvedIdsV1 = (id, version) => vm.runInContext(
  `(App.getResolvedConceptSet(${JSON.stringify(id)}, ${JSON.stringify(version)}) || []).map(function (c) { return c.conceptId })`,
  context,
)

// --- Synthetic mapped sets --------------------------------------------------------

// Deterministic PRNG (mulberry32) so regenerating gives the same fixture.
function rng(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const entries = [...pairs.values()].sort((a, b) => a.id - b.id || String(a.version).localeCompare(String(b.version)))
const idsOf = new Map(entries.map((e) => [`${e.id}@${e.version}`, resolvedIdsV1(e.id, e.version)]))
const NOISE = [0, -1, 42, 2147483647]

const mappedSets = { empty: [], noise: NOISE }
mappedSets.everyFirst = [...new Set(entries.flatMap((e) => idsOf.get(`${e.id}@${e.version}`).slice(0, 1)))]
mappedSets.evenIds = [
  ...new Set(entries.filter((e) => e.id % 2 === 0).flatMap((e) => idsOf.get(`${e.id}@${e.version}`).slice(-1))),
]
const random = rng(20261011)
mappedSets.random30 = [
  ...new Set(
    entries.flatMap((e) => {
      const ids = idsOf.get(`${e.id}@${e.version}`)
      return ids.length && random() < 0.3 ? [ids[Math.floor(random() * ids.length)]] : []
    }),
  ),
]
// Ids only in the current resolved list of a set pinned to an older version: covers
// nothing when the pinned version is honoured, everything if it were ignored.
mappedSets.currentOnly = [
  ...new Set(
    entries
      .filter((e) => e.version && currentVersions[e.id] && e.version !== currentVersions[e.id])
      .flatMap((e) => {
        const pinned = new Set(idsOf.get(`${e.id}@${e.version}`))
        return (resolvedIndex[e.id] || []).map((c) => c.conceptId).filter((id) => !pinned.has(id)).slice(0, 1)
      }),
  ),
]
for (const name of Object.keys(mappedSets)) mappedSets[name].sort((a, b) => a - b)

/** The v1 result minus what is presentation (the localized group name, the project object). */
function project(result) {
  return {
    projectId: result.project.id,
    score: result.score,
    eligible: result.eligible,
    groups: result.groups.map((g) => ({
      id: g.id,
      rule: g.rule,
      coveredCount: g.coveredCount,
      total: g.total,
      perCS: g.perCS.map((c) => ({ id: c.id, version: c.version, covered: c.covered, total: c.total })),
      score: g.score,
      satisfied: g.satisfied,
    })),
  }
}

const results = {}
for (const [name, conceptIds] of Object.entries(mappedSets)) {
  const out = vm.runInContext(`evaluateAllProjects(${JSON.stringify({ conceptIds })})`, context)
  results[name] = JSON.parse(JSON.stringify(out.map(project)))
}

// --- Inputs, reduced to what the evaluation depends on ----------------------------

const allMapped = new Set(Object.values(mappedSets).flat())
const resolved = {}
for (const [key, ids] of idsOf) {
  resolved[key] = { total: ids.length, ids: ids.filter((id) => allMapped.has(id)).sort((a, b) => a - b) }
}

const pinnedCurrent = {}
for (const e of entries) if (currentVersions[e.id]) pinnedCurrent[e.id] = currentVersions[e.id]

const inputs = {
  generatedFrom: 'legacy/app.js + legacy/mapping.js (v1), see apps/web/scripts/generate-coverage-goldens.mjs',
  currentVersions: pinnedCurrent,
  resolved,
  projects,
  mappedSets,
}

mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'inputs.json'), JSON.stringify(inputs) + '\n')
writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results) + '\n')
process.stdout.write(
  `Wrote ${path.relative(root, outDir)}: ${projects.length} projects, ${entries.length} pinned entries, ` +
    `${Object.keys(mappedSets).length} mapped sets (${[...allMapped].length} ids)\n`,
)
