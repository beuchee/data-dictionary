// Adapted from linkr@1310cf4a4 apps/web/vite.config.ts
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { existsSync, readFileSync, readdirSync, rmSync } from 'fs'

const REPO_ROOT = path.resolve(__dirname, '../..')
const INSTANCE_CONFIG = path.join(REPO_ROOT, 'config.json')
// Branding images: v1's live in legacy/ (`logo.png`); those uploaded from v2's
// Branding settings live in branding/ at the repo root (`branding/logo.png`, a
// path config.json names as is; build.py copies the folder next to v1's pages).
// TODO(v2-cutover): move v1's images to branding/ and drop the legacy/ lookup.
const LEGACY_BRANDING_DIR = path.join(REPO_ROOT, 'legacy')
const BRANDING_PREFIX = 'branding/'
// TODO(v2-cutover): build.py writes the static payload into legacy/ for v1. Move its
// output to a v2 location and drop this indirection; the app reads it as data/.
const STATIC_PAYLOAD = path.join(REPO_ROOT, 'legacy', 'data.json')
const STATIC_RESOLVED_DIR = path.join(REPO_ROOT, 'legacy', 'concept_sets_resolved')
// Every concept id of the resolved lists: the browser vocabulary import keeps only
// their relationships and synonyms (lib/vocabulary/wasm/athena-files.ts).
const STATIC_RESOLVED_IDS = path.join(REPO_ROOT, 'legacy', 'resolved_concept_ids.json')
const RESOLVED_FILE = /^[1-9][0-9]*\.json$/
const MISSING_PAYLOAD_WARNING =
  '[instance-config] legacy/data.json not found: static mode has no catalogue to show. Run `python3 build.py` at the repo root.'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** A branding path from config.json → `[rel, file]`, kept only if the file exists inside its folder. */
function safeBrandingFile(name: unknown): [string, string] | null {
  if (typeof name !== 'string' || !name.trim()) return null
  const rel = name.replace(/^\/+/, '')
  const dir = rel.startsWith(BRANDING_PREFIX) ? path.join(REPO_ROOT, 'branding') : LEGACY_BRANDING_DIR
  const abs = path.resolve(rel.startsWith(BRANDING_PREFIX) ? REPO_ROOT : LEGACY_BRANDING_DIR, rel)
  if (!abs.startsWith(dir + path.sep)) return null
  return existsSync(abs) ? [rel, abs] : null
}

function brandingFiles(): Map<string, string> {
  try {
    const config = JSON.parse(readFileSync(INSTANCE_CONFIG, 'utf-8'))
    return new Map(
      [config?.branding?.logo, config?.branding?.favicon]
        .map(safeBrandingFile)
        .filter((f): f is [string, string] => f !== null),
    )
  } catch {
    return new Map()
  }
}

/** `data/data.json` → the payload, `data/concept_sets_resolved/<id>.json` → a deferred list. */
function staticDataFile(rel: string): string | null {
  if (rel === 'data/data.json') return STATIC_PAYLOAD
  if (rel === 'data/resolved_concept_ids.json') return STATIC_RESOLVED_IDS
  const prefix = 'data/concept_sets_resolved/'
  if (rel.startsWith(prefix) && RESOLVED_FILE.test(rel.slice(prefix.length))) {
    return path.join(STATIC_RESOLVED_DIR, rel.slice(prefix.length))
  }
  return null
}

/**
 * The instance config lives at the repo root, shared with v1 and the Python scripts,
 * so it is not copied into public/: dev serves it live (edits show on reload) and the
 * build emits it, with the logo and favicon it names, next to index.html. Same for
 * the static-mode payload build.py writes (data/), emitted only by a static build.
 */
function instanceConfigPlugin(basePrefix: string, staticMode: boolean): Plugin {
  return {
    name: 'instance-config',
    configureServer(server) {
      if (staticMode && !existsSync(STATIC_PAYLOAD)) server.config.logger.warn(MISSING_PAYLOAD_WARNING)
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!urlPath.startsWith(`${basePrefix}/`)) return next()
        const rel = urlPath.slice(basePrefix.length + 1)
        const file = rel === 'config.json' ? INSTANCE_CONFIG : (brandingFiles().get(rel) ?? staticDataFile(rel))
        if (!file || !existsSync(file)) return next()
        const ext = path.extname(file).toLowerCase()
        res.setHeader('Content-Type', ext === '.json' ? 'application/json' : (CONTENT_TYPES[ext] ?? 'application/octet-stream'))
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'config.json', source: readFileSync(INSTANCE_CONFIG) })
      for (const [rel, file] of brandingFiles()) {
        this.emitFile({ type: 'asset', fileName: rel, source: readFileSync(file) })
      }
      // A server build reads the content through the API: the payload would be dead weight.
      if (!staticMode) return
      if (!existsSync(STATIC_PAYLOAD)) {
        this.warn(MISSING_PAYLOAD_WARNING)
        return
      }
      this.emitFile({ type: 'asset', fileName: 'data/data.json', source: readFileSync(STATIC_PAYLOAD) })
      if (existsSync(STATIC_RESOLVED_IDS)) {
        this.emitFile({ type: 'asset', fileName: 'data/resolved_concept_ids.json', source: readFileSync(STATIC_RESOLVED_IDS) })
      }
      if (existsSync(STATIC_RESOLVED_DIR)) {
        for (const name of readdirSync(STATIC_RESOLVED_DIR).filter((n) => RESOLVED_FILE.test(n))) {
          this.emitFile({
            type: 'asset',
            fileName: `data/concept_sets_resolved/${name}`,
            source: readFileSync(path.join(STATIC_RESOLVED_DIR, name)),
          })
        }
      }
    },
  }
}

// Adapted from linkr@1310cf4a4 apps/web/vite.config.ts (stripCoiInServerMode).
// coi-serviceworker makes a static host cross-origin isolated (COOP/COEP) for
// DuckDB-WASM. A server build never runs DuckDB-WASM, and there the worker would
// intercept API calls (breaking uploads); the dev server sends the real headers
// itself. So the script is kept only in a static build.
// A server build also drops the DuckDB-WASM bundles (~70 MB) public/ would copy.
function stripCoi(keep: boolean): Plugin {
  let outDir = ''
  return {
    name: 'strip-coi-serviceworker',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      if (keep || !outDir) return
      rmSync(path.join(outDir, 'duckdb'), { recursive: true, force: true })
      rmSync(path.join(outDir, 'coi-serviceworker.js'), { force: true })
    },
    transformIndexHtml(html, ctx) {
      if (keep && !ctx.server) return html
      return html
        .replace(/<script>window\.coi[\s\S]*?<\/script>\s*/, '')
        .replace(/<script src="[^"]*coi-serviceworker\.js"><\/script>\s*/, '')
    },
  }
}

// Sub-path deployments (GitHub/GitLab Pages project sites, reverse proxies): BASE_PATH
// prefixes every asset URL and, via Vite's BASE_URL, the router basename in main.tsx.
function normalizeBasePath(raw: string | undefined) {
  const trimmed = (raw || '/').trim()
  if (trimmed === '' || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export default defineConfig(({ mode }) => {
  // loadEnv with an empty prefix is required to read non-VITE_ keys (WEB_PORT, API_PORT).
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env }
  const webPort = Number(env.WEB_PORT) || 3000
  const apiPort = Number(env.API_PORT) || 8000
  const basePath = normalizeBasePath(env.BASE_PATH)
  const basePrefix = basePath.slice(0, -1)
  const unprefix = (p: string) => p.slice(basePrefix.length)

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), instanceConfigPlugin(basePrefix, !env.VITE_API_URL), stripCoi(!env.VITE_API_URL)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: webPort,
      ...(env.WEB_HOST ? { host: env.WEB_HOST } : {}),
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // Under a sub-path, API calls carry the prefix; the backend serves /api at its root.
      proxy: {
        [`${basePrefix}/api`]: {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          rewrite: unprefix,
        },
      },
    },
    preview: {
      port: webPort,
    },
  }
})
