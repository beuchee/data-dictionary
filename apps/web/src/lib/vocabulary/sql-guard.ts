// Read-only check of a Dev tools query in the browser (static mode), where the
// server's guard (DuckDB's parser + a locked sandbox connection, see
// apps/api/app/services/vocabulary_sql.py) is not there. The vocabulary lives in
// the user's own tab, so this protects it from an accident, not from an attacker.

export type SqlRefusal = 'empty' | 'several_statements' | 'not_read_only'

const READ_STARTS = new Set(['select', 'with', 'from', 'values', 'describe', 'show', 'summarize', 'explain', 'table'])
const WRITE_WORDS = new Set([
  'insert', 'update', 'delete', 'create', 'drop', 'alter', 'copy', 'attach', 'detach', 'install', 'load',
  'export', 'import', 'set', 'reset', 'call', 'checkpoint', 'vacuum', 'truncate', 'pragma', 'use', 'merge',
])

export interface SqlStatement {
  /** The statement without trailing `;`, comments kept. */
  text: string
  /** Lower-cased bare words, outside strings, quoted identifiers and comments. */
  words: string[]
}

/** Statements of `sql`, split on `;` outside strings, quoted identifiers and comments. */
export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = []
  let start = 0
  let words: string[] = []
  let i = 0
  const push = (end: number) => {
    const text = sql.slice(start, end).trim()
    if (words.length > 0) out.push({ text, words })
    words = []
  }
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'" || c === '"') {
      const close = sql.indexOf(c, i + 1)
      // A doubled quote continues the string.
      let j = close
      while (j >= 0 && sql[j + 1] === c) j = sql.indexOf(c, j + 2)
      i = j < 0 ? sql.length : j + 1
      if (c === "'") words.push("'")
    } else if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      i = nl < 0 ? sql.length : nl + 1
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
    } else if (c === ';') {
      push(i)
      i++
      start = i
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++
      words.push(sql.slice(i, j).toLowerCase())
      i = j
    } else {
      if (c === '(' || /[0-9]/.test(c)) words.push(c)
      i++
    }
  }
  push(sql.length)
  return out
}

/** null when `sql` is one read-only statement, else why not. */
export function checkReadOnlySql(sql: string): SqlRefusal | null {
  const statements = splitStatements(sql)
  if (statements.length === 0) return 'empty'
  if (statements.length > 1) return 'several_statements'
  const { words } = statements[0]
  const first = words.find((w) => w !== '(')
  if (!first || !READ_STARTS.has(first)) return 'not_read_only'
  if (words.some((w) => WRITE_WORDS.has(w))) return 'not_read_only'
  return null
}

/** Whether a statement can be wrapped as `SELECT * FROM (…) LIMIT n` to cap its rows. */
export function isWrappable(statement: SqlStatement): boolean {
  const first = statement.words.find((w) => w !== '(')
  return first === 'select' || first === 'with' || first === 'from' || first === 'values' || first === 'table'
}

/**
 * The statement to run for at most `limit` rows: a query wrapped so DuckDB stops
 * at `limit + 1` (the extra row tells the result was cut), DESCRIBE / SHOW /
 * EXPLAIN as they are. The newline keeps a trailing `--` comment from eating the `)`.
 */
export function limitedSql(sql: string, limit: number): string {
  const [statement] = splitStatements(sql)
  if (!statement) return sql
  return isWrappable(statement) ? `SELECT * FROM (\n${statement.text}\n) LIMIT ${limit + 1}` : statement.text
}
