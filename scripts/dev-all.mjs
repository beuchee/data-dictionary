#!/usr/bin/env node
// Run the frontend and the backend together in one terminal, prefixing each
// line with its source. Ctrl+C stops both. Adapted from Linkr's dev-all.mjs.

import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readEnvValue(key) {
  const envFile = path.join(repoRoot, 'apps/web/.env.local')
  if (!existsSync(envFile)) return undefined
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (match && match[1] === key) return match[2].trim()
  }
  return undefined
}

const webPort = process.env.WEB_PORT || readEnvValue('WEB_PORT') || '3000'
// dev:all starts the API, so the web app talks to it (server mode) unless
// VITE_API_URL is set otherwise. "/" goes through the vite proxy: no CORS.
const env = { ...process.env }
if (env.VITE_API_URL === undefined && readEnvValue('VITE_API_URL') === undefined) env.VITE_API_URL = '/'

const procs = [
  { label: 'web', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev:web'] },
  { label: 'api', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev:api'] },
]

const children = procs.map(({ label, color, cmd, args }) => {
  // detached makes each child lead its own process group, so stopping can signal
  // the whole group: killing the npm wrapper alone leaves vite and uvicorn running.
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: true,
  })
  const prefix = `${color}${label.padEnd(3)}\x1b[0m │ `
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = ''
    stream.on('data', (chunk) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) process.stdout.write(prefix + line + '\n')
    })
  }
  return child
})

console.log(`\n  ${path.basename(repoRoot)}  →  http://localhost:${webPort}   (Ctrl+C to stop)\n`)

// One process dying takes the other down: a half-running stack silently serving
// stale behaviour is worse than a clean stop.
let stopping = false
const stopAll = (signal = 'SIGTERM') => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      /* already gone */
    }
  }
}

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))

children.forEach((child) => {
  child.on('exit', (code) => {
    stopAll()
    process.exitCode = code ?? 0
  })
})
