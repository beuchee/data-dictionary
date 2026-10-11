import { describe, expect, it } from 'vitest'
import { checkReadOnlySql, limitedSql, splitStatements } from './sql-guard'
import { apiDetail } from './api-source'

describe('checkReadOnlySql', () => {
  it.each([
    'SELECT * FROM concept',
    'select 1;',
    '  -- a comment\nWITH x AS (SELECT 1) SELECT * FROM x',
    'DESCRIBE concept',
    'SHOW TABLES',
    'FROM vocabulary',
    '(SELECT 1)',
    "SELECT 'drop table; insert' AS s",
    'SELECT "delete" FROM t',
    "SELECT 'it''s; fine'",
    'EXPLAIN SELECT 1',
    '/* drop */ SELECT 1',
  ])('accepts %s', (sql) => {
    expect(checkReadOnlySql(sql)).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['  ;  -- nothing', 'empty'],
    ['SELECT 1; SELECT 2', 'several_statements'],
    ['SELECT 1; DROP VIEW concept', 'several_statements'],
    ['DROP VIEW concept', 'not_read_only'],
    ['CREATE TABLE t AS SELECT 1', 'not_read_only'],
    ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'not_read_only'],
    ["COPY concept TO 'x.csv'", 'not_read_only'],
    ['ATTACH \'x.db\'', 'not_read_only'],
    ['SET threads = 1', 'not_read_only'],
    ['PRAGMA enable_profiling', 'not_read_only'],
    ['INSTALL httpfs', 'not_read_only'],
  ])('refuses %s', (sql, reason) => {
    expect(checkReadOnlySql(sql)).toBe(reason)
  })
})

describe('limitedSql', () => {
  it('wraps a query, keeping a trailing comment out of the way', () => {
    expect(limitedSql('SELECT 1 -- one\n;', 10)).toBe('SELECT * FROM (\nSELECT 1 -- one\n) LIMIT 11')
  })

  it('runs DESCRIBE / SHOW / EXPLAIN as they are', () => {
    expect(limitedSql('DESCRIBE concept;', 10)).toBe('DESCRIBE concept')
    expect(limitedSql('SHOW TABLES', 10)).toBe('SHOW TABLES')
  })

  it('keeps a semicolon inside a string', () => {
    expect(splitStatements("SELECT ';' AS x;")).toHaveLength(1)
  })
})

describe('apiDetail', () => {
  it("reads FastAPI's detail", () => {
    expect(apiDetail('{"detail":"Only read-only queries"}')).toBe('Only read-only queries')
    expect(apiDetail('oops')).toBe('oops')
  })
})
