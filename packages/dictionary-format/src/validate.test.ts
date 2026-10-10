/** Adversarial and legacy shapes: what the schemas must reject, and accept. */
import { describe, expect, it } from 'vitest'
import { parse } from './parse.ts'
import { readRepoFile } from './test-helpers.ts'
import { assertValid, DictionaryFormatError, formatIssues, validate, validateFile, type ValidationIssue } from './validate.ts'

const load = <T = any>(rel: string): T => parse<T>(readRepoFile(rel))
const clone = <T>(v: T): T => structuredClone(v)

function issueAt(issues: ValidationIssue[], pointer: string): ValidationIssue {
  const found = issues.find((i) => i.pointer === pointer)
  if (!found) throw new Error(`no issue at ${pointer}:\n${formatIssues(issues)}`)
  return found
}

describe('rejects with a useful message', () => {
  it('a human-label reviewStatus ("pending review")', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.metadata.reviewStatus = 'pending review'
    const { valid, errors } = validate('concept-set', cs)
    expect(valid).toBe(false)
    const issue = issueAt(errors, '/metadata/reviewStatus')
    expect(issue.kind).toBe('concept-set')
    expect(issue.keyword).toBe('enum')
    expect(issue.message).toContain('"pending_review"')
    expect(issue.message).toContain('got "pending review"')
  })

  it('a caption used as standardConcept ("Standard")', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.expression.items[0].concept.standardConcept = 'Standard'
    const issue = issueAt(validate('concept-set', cs).errors, '/expression/items/0/concept/standardConcept')
    expect(issue.message).toMatch(/must be one of "S", "C", null, ""/)
  })

  it('a missing uniqueId', () => {
    const cs = clone(load('concept_sets/1.json'))
    delete cs.metadata.uniqueId
    const issue = issueAt(validate('concept-set', cs).errors, '/metadata')
    expect(issue.keyword).toBe('required')
    expect(issue.message).toBe('missing required property "uniqueId"')
  })

  it('a malformed uniqueId', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.metadata.uniqueId = 'not-a-uuid'
    expect(issueAt(validate('concept-set', cs).errors, '/metadata/uniqueId').message).toContain('not-a-uuid')
  })

  it('a wrong group rule', () => {
    const project = clone(load('projects/1.json'))
    project.groups[0].rule = 'required_all'
    const issue = issueAt(validate('project', project).errors, '/groups/0/rule')
    expect(issue.message).toBe('must be one of "all_required", "at_least_one", "optional" (got "required_all")')
  })

  it('a non-semver version, a bad date, a field-first translation key', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.version = 'v1.0'
    cs.modifiedDate = '2026-13-45'
    cs.metadata.translations.English = { name: 'x' }
    const errors = validate('concept-set', cs).errors
    issueAt(errors, '/version')
    issueAt(errors, '/modifiedDate')
    expect(errors.some((e) => e.keyword === 'propertyNames' && e.message.includes('English'))).toBe(true)
  })

  it('a project without any concept-set list, a pinned set without version', () => {
    const project = clone(load('projects/1.json'))
    project.groups[0].conceptSets[0] = { id: 1 }
    issueAt(validate('project', project).errors, '/groups/0/conceptSets/0')
    delete project.groups
    expect(validate('project', project).valid).toBe(false)
  })

  it('a string conversion factor, bad colors, a non-boolean anonymousRead', () => {
    const conv = clone(load('units/unit_conversions.json')).slice(0, 2)
    conv[1].conversionFactor = '1.5'
    issueAt(validate('unit-conversions', conv).errors, '/1/conversionFactor')
    const config = clone(load('config.json'))
    config.branding.colors = { primary: 'blue' }
    config.access = { anonymousRead: 'yes' }
    const errors = validate('config', config).errors
    issueAt(errors, '/branding/colors/primary')
    issueAt(errors, '/access/anonymousRead')
  })

  it('a malformed versions index', () => {
    const errors = validate('concept-sets-versions', { '1': { '1.0': 'abc' } }).errors
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('assertValid throws a DictionaryFormatError listing every issue', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.metadata.reviewStatus = 'Approved'
    expect(() => assertValid('concept-set', cs, 'concept_sets/1.json')).toThrow(DictionaryFormatError)
    expect(() => assertValid('concept-set', cs, 'concept_sets/1.json')).toThrow(/concept_sets\/1\.json: 1 format error\(s\)\n {2}concept-set \/metadata\/reviewStatus: must be one of/)
  })
})

describe('accepts legacy shapes still read by v1 / Linkr', () => {
  it('flat organization {name, url}, no sourceRepo / origin, review without status, "" standardConcept', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.metadata.organization = { name: 'Old Org', url: 'https://example.org' }
    delete cs.metadata.sourceRepo
    delete cs.metadata.origin
    cs.metadata.reviews = [{ reviewId: 1, reviewer: { firstName: 'A', lastName: 'B' }, reviewTimestamp: '2026-01-01T00:00:00.000Z', comments: '', version: '1.0.0' }]
    cs.expression.items[0].concept.standardConcept = ''
    cs.expression.items[0].concept.validStartDate = '19700101'
    cs.expression.items[0].concept.validEndDate = ''
    expect(formatIssues(validate('concept-set', cs).errors)).toBe('')
  })

  it('organization {created} without current', () => {
    const cs = clone(load('concept_sets/1.json'))
    delete cs.metadata.organization.current
    expect(validate('concept-set', cs).valid).toBe(true)
  })

  it('an imported set with a frozen origin', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.metadata.origin = {
      uniqueId: cs.metadata.uniqueId,
      repo: 'https://gitlab.com/other/dictionary',
      version: '1.0.0',
      commit: 'ce8fd47179e877f3b338815a6c9ee226cac43311',
      organization: { name: 'Other', url: 'https://other.org' },
      importedDate: '2026-09-01',
    }
    expect(validate('concept-set', cs).valid).toBe(true)
  })

  it('projects with the flat conceptSets list or conceptSetIds, groups with a legacy name', () => {
    const base = clone(load('projects/1.json'))
    const { groups, ...rest } = base
    expect(validate('project', { ...rest, conceptSets: [{ id: 1, version: '1.0.0' }] }).valid).toBe(true)
    expect(validate('project', { ...rest, conceptSetIds: [1, 2, 3] }).valid).toBe(true)
    const legacyGroup = { id: 'g', name: { en: 'Default', fr: 'Par défaut' }, rule: 'optional', conceptSets: [] }
    expect(validate('project', { ...rest, groups: [legacyGroup] }).valid).toBe(true)
    expect(groups.length).toBeGreaterThan(0)
  })

  it('config with the legacy `github` block, and with every new v2 key', () => {
    const config = clone(load('config.json'))
    config.github = config.repository
    delete config.repository
    expect(validate('config', config).valid).toBe(true)
    config.branding = {
      ...config.branding,
      appName: 'My Dictionary',
      colors: { primary: '#1f6feb', secondary: '#6e40c9', accent: '#2ea44f' },
      darkColors: { primary: '#58a6ff' },
      font: 'Inter',
    }
    config.access = { anonymousRead: false }
    expect(formatIssues(validate('config', config).errors)).toBe('')
  })

  it('a resolved set without vocabularyVersion info and with a null standardConcept', () => {
    const resolved = clone(load('concept_sets_resolved/1.json'))
    resolved.vocabularyVersion = null
    resolved.resolvedConcepts[0].standardConcept = null
    expect(validate('concept-set-resolved', resolved).valid).toBe(true)
  })

  it('unknown fields everywhere', () => {
    const cs = clone(load('concept_sets/1.json'))
    cs.forkField = 1
    cs.metadata.forkMeta = { a: 1 }
    cs.expression.items[0].concept.extra = 'x'
    cs.metadata.translations.en.forkText = 'y'
    expect(validate('concept-set', cs).valid).toBe(true)
  })
})

describe('validateFile', () => {
  it('detects the kind from the path', () => {
    expect(validateFile('projects/2.json', readRepoFile('projects/2.json')).valid).toBe(true)
    expect(() => validateFile('README.md', '{}')).toThrow(/Not a dictionary content file/)
  })
})
