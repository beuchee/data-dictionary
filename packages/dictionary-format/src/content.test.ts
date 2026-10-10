/** The contract against reality: every content file of this repository. */
import { describe, expect, it } from 'vitest'
import { contentFiles, NON_CANONICAL, readRepoFile } from './test-helpers.ts'
import { parse } from './parse.ts'
import { serialize } from './serialize.ts'
import { formatIssues, validate } from './validate.ts'

const files = contentFiles()

describe('real content files', () => {
  it('covers every kind and the expected volume', () => {
    const count = (k: string) => files.filter((f) => f.kind === k).length
    expect(count('concept-set')).toBeGreaterThan(300)
    expect(count('concept-set-resolved')).toBe(count('concept-set'))
    expect(count('project')).toBeGreaterThan(0)
    expect(new Set(files.map((f) => f.kind)).size).toBe(9)
  })

  it('all validate against their schema', () => {
    const failures: string[] = []
    for (const { path, kind } of files) {
      const result = validate(kind, parse(readRepoFile(path)))
      if (!result.valid) failures.push(`${path}\n${formatIssues(result.errors)}`)
    }
    expect(failures).toEqual([])
  })

  it('round-trip byte for byte (parse → serialize), except the listed non-canonical files', () => {
    const mismatches: string[] = []
    for (const { path, kind } of files) {
      if (path in NON_CANONICAL) continue
      const raw = readRepoFile(path)
      if (serialize(parse(raw), { kind }) !== raw) mismatches.push(path)
    }
    expect(mismatches).toEqual([])
  })

  it.each(Object.keys(NON_CANONICAL))('%s is still non-canonical (else drop it from the exception list), but stable once rewritten', (path) => {
    const kind = files.find((f) => f.path === path)?.kind
    expect(kind).toBeDefined()
    const raw = readRepoFile(path)
    const once = serialize(parse(raw), { kind })
    expect(once).not.toBe(raw)
    expect(parse(once)).toEqual(parse(raw))
    expect(serialize(parse(once), { kind })).toBe(once)
  })

  it('concept_set.example.json (the annotated schema) validates as a concept set', () => {
    // Its placeholder id 0 is the one thing a real file may not have.
    const example = parse<Record<string, unknown>>(readRepoFile('concept_set.example.json'))
    expect(validate('concept-set', example).errors.map((e) => e.pointer)).toEqual(['/id'])
    const result = validate('concept-set', { ...example, id: 1 })
    expect(formatIssues(result.errors)).toBe('')
  })
})
