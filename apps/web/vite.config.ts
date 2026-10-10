// Adapted from linkr@1310cf4a4 apps/web/vite.config.ts
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { existsSync, readFileSync } from 'fs'

const REPO_ROOT = path.resolve(__dirname, '../..')
const INSTANCE_CONFIG = path.join(REPO_ROOT, 'config.json')
// TODO(v2-cutover): move the branding images out of legacy/ (v1 keeps them there) to a
// location both builds can read, then drop this indirection.
const BRANDING_DIR = path.join(REPO_ROOT, 'legacy')

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** A branding path from config.json, kept only if it stays inside BRANDING_DIR. */
function safeBrandingFile(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  const rel = name.replace(/^\/+/, '')
  const abs = path.resolve(BRANDING_DIR, rel)
  if (!abs.startsWith(BRANDING_DIR + path.sep)) return null
  return existsSync(abs) ? rel : null
}

function brandingFiles(): string[] {
  try {
    const config = JSON.parse(readFileSync(INSTANCE_CONFIG, 'utf-8'))
    return [config?.branding?.logo, config?.branding?.favicon]
      .map(safeBrandingFile)
      .filter((f): f is string => f !== null)
  } catch {
    return []
  }
}

/**
 * The instance config lives at the repo root, shared with v1 and the Python scripts,
 * so it is not copied into public/: dev serves it live (edits show on reload) and the
 * build emits it, with the logo and favicon it names, next to index.html.
 */
function instanceConfigPlugin(basePrefix: string): Plugin {
  return {
    name: 'instance-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!urlPath.startsWith(`${basePrefix}/`)) return next()
        const rel = urlPath.slice(basePrefix.length + 1)
        let file: string | null = null
        if (rel === 'config.json') file = INSTANCE_CONFIG
        else if (brandingFiles().includes(rel)) file = path.join(BRANDING_DIR, rel)
        if (!file || !existsSync(file)) return next()
        const ext = path.extname(file).toLowerCase()
        res.setHeader('Content-Type', ext === '.json' ? 'application/json' : (CONTENT_TYPES[ext] ?? 'application/octet-stream'))
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'config.json', source: readFileSync(INSTANCE_CONFIG) })
      for (const rel of brandingFiles()) {
        this.emitFile({ type: 'asset', fileName: rel, source: readFileSync(path.join(BRANDING_DIR, rel)) })
      }
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
    plugins: [react(), tailwindcss(), instanceConfigPlugin(basePrefix)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: webPort,
      ...(env.WEB_HOST ? { host: env.WEB_HOST } : {}),
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
