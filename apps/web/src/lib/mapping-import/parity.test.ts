// The shared fixtures (apps/api/tests/fixtures/mappings): this parser and the
// Python one (tests/test_mapping_import.py) must give the same expected/*.json.
// UPDATE_MAPPING_GOLDEN=1 rewrites them from this implementation: review the diff.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectFormat, expandFiles, MappingImportError, parseMapping, type ParseOptions } from './index'

const ROOT = path.resolve(__dirname, '../../../../api/tests/fixtures/mappings')
const UPDATE = process.env.UPDATE_MAPPING_GOLDEN === '1'

interface Case {
  name: string
  files: string[]
  detect?: string
  options: ParseOptions
  error?: string
}

const cases: Case[] = JSON.parse(readFileSync(path.join(ROOT, 'cases.json'), 'utf-8'))

function load(c: Case) {
  return c.files.map((f) => ({ name: path.basename(f), data: new Uint8Array(readFileSync(path.join(ROOT, 'inputs', f))) }))
}

function run(c: Case): unknown {
  const files = load(c)
  const out: Record<string, unknown> = {}
  if (c.detect) out.detect = detectFormat(expandFiles(files))
  try {
    out.result = parseMapping(files, c.options)
  } catch (error) {
    if (!(error instanceof MappingImportError)) throw error
    out.error = error.code
  }
  return JSON.parse(JSON.stringify(out))
}

describe('mapping import fixtures', () => {
  for (const c of cases) {
    it(c.name, () => {
      const actual = run(c) as { detect?: { format: string }; error?: string }
      if (c.detect) expect(actual.detect?.format).toBe(c.detect)
      expect(actual.error).toBe(c.error)
      const file = path.join(ROOT, 'expected', `${c.name}.json`)
      if (UPDATE) {
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`)
      }
      expect(existsSync(file)).toBe(true)
      expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf-8')))
    })
  }
})
