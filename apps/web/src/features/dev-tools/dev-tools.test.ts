import { describe, expect, it } from 'vitest'
import { ERD_TABLES, erdLayout } from './erd-layout'
import { resultCsv } from './results-csv'
import { checkReadOnlySql } from '@/lib/vocabulary/sql-guard'
import { EXAMPLE_QUERIES } from './examples'

describe('erdLayout', () => {
  const layout = erdLayout()

  it('places every table once, without overlap', () => {
    expect(layout.boxes.map((b) => b.table.name).sort()).toEqual(ERD_TABLES.map((t) => t.name).sort())
    for (const a of layout.boxes) {
      for (const b of layout.boxes) {
        if (a === b) continue
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `${a.table.name} / ${b.table.name}`).toBe(false)
      }
    }
    for (const b of layout.boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(layout.width)
      expect(b.y + b.h).toBeLessThanOrEqual(layout.height)
    }
  })

  it('draws one edge per foreign key to another table', () => {
    const fks = ERD_TABLES.flatMap((t) => t.columns.filter((c) => c.fk && c.fk !== t.name))
    expect(layout.edges).toHaveLength(fks.length)
    expect(layout.edges.every((e) => /^M [\d.]+ [\d.]+ C /.test(e.d))).toBe(true)
    expect(new Set(layout.edges.map((e) => e.key)).size).toBe(layout.edges.length)
  })
})

describe('resultCsv', () => {
  it('quotes, doubles quotes, defuses formulas, keeps numbers', () => {
    expect(resultCsv(['a', 'b'], [[1, 'x"y'], ['=SUM(A1)', null], [-5, '-x']])).toBe(
      '\uFEFF"a","b"\n"1","x""y"\n"\'=SUM(A1)",""\n"-5","\'-x"\n',
    )
  })
})

describe('example queries', () => {
  it('are all read-only', () => {
    for (const q of EXAMPLE_QUERIES) expect(checkReadOnlySql(q.sql), q.id).toBeNull()
  })
})
