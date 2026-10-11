import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, serialize, validate, type Config } from '@data-dictionary/format'
import { MIN_CONTRAST } from '@/lib/theme'
import {
  ASSETS_KEY,
  applyBrandingForm,
  brandingForm,
  checkAssetFile,
  configDraftContent,
  contrastCheck,
  previewVariables,
  splitConfigDraft,
  validateBrandingForm,
} from './branding-form'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const CONFIG = parse<Config>(readFileSync(path.join(REPO, 'config.json'), 'utf-8'))

describe('config ⇄ form', () => {
  it('an untouched form gives back the same config, key order included', () => {
    const out = applyBrandingForm(CONFIG, brandingForm(CONFIG))
    expect(serialize(out)).toBe(serialize(CONFIG))
    expect(validate('config', out).valid).toBe(true)
  })

  it('edits keys in place and keeps what the form does not own', () => {
    const form = { ...brandingForm(CONFIG), appName: 'My Dictionary', primary: '#1f6feb', organizationName: 'ACME' }
    const out = applyBrandingForm(CONFIG, form)
    expect(Object.keys(out)).toEqual(Object.keys(CONFIG))
    expect(out.branding).toEqual({ ...CONFIG.branding, appName: 'My Dictionary', colors: { primary: '#1f6feb' } })
    expect(out.organization?.name).toBe('ACME')
    expect(out.repository).toEqual(CONFIG.repository)
    expect(validate('config', out).valid).toBe(true)
  })

  it('drops emptied optional keys instead of writing empty strings', () => {
    const base: Config = { title: 'X', languages: ['en'], branding: { appName: 'A', colors: { primary: '#000' } }, organization: { name: 'O' } }
    const out = applyBrandingForm(base, { ...brandingForm(base), appName: ' ', primary: '', organizationName: '' })
    expect(out.branding).toBeUndefined()
    expect(out.organization).toBeUndefined()
  })

  it('writes defaults only when they change or were already written', () => {
    const base: Config = { title: 'X', languages: ['en'] }
    expect(applyBrandingForm(base, brandingForm(base))).toEqual({ title: 'X', languages: ['en'], defaultLanguage: 'en' })
    const off = applyBrandingForm(base, { ...brandingForm(base), anonymousRead: false, showProjects: false })
    expect(off.access).toEqual({ anonymousRead: false })
    expect(off.tabs).toEqual({ showProjects: false })
    const backOn = applyBrandingForm(off, { ...brandingForm(off), anonymousRead: true })
    expect(backOn.access).toEqual({ anonymousRead: true })
  })

  it('keeps the default language among the languages', () => {
    const out = applyBrandingForm(CONFIG, { ...brandingForm(CONFIG), languages: ['fr', 'de'], defaultLanguage: 'en' })
    expect(out.languages).toEqual(['fr', 'de'])
    expect(out.defaultLanguage).toBe('fr')
  })

  it('validates', () => {
    const ok = brandingForm(CONFIG)
    expect(validateBrandingForm(ok)).toBeNull()
    expect(validateBrandingForm({ ...ok, title: ' ' })).toBe('title_required')
    expect(validateBrandingForm({ ...ok, languages: [] })).toBe('languages_required')
    expect(validateBrandingForm({ ...ok, languages: ['en', 'EN'] })).toBe('invalid_language')
    expect(validateBrandingForm({ ...ok, primary: 'blue' })).toBe('invalid_primary')
    expect(validateBrandingForm({ ...ok, secondary: '#12345' })).toBe('invalid_secondary')
    expect(validateBrandingForm({ ...ok, organizationUrl: 'javascript:alert(1)' })).toBe('invalid_organization_url')
  })
})

describe('color preview', () => {
  it('derives light and dark tokens from lib/theme', () => {
    const vars = previewVariables('#1f6feb', '')
    expect(vars.light['--primary']).toMatch(/^oklch\(/)
    expect(vars.dark['--primary']).toMatch(/^oklch\(/)
    expect(vars.light['--secondary']).toBeUndefined()
  })

  it('checks contrast both ways', () => {
    const blue = contrastCheck('#1f6feb')
    expect(blue?.onColor).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(blue?.darkOnBackground).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(blue?.passes).toBe(true)
    expect(contrastCheck('nope')).toBeNull()
  })
})

describe('images', () => {
  it('checks type and size before upload', () => {
    expect(checkAssetFile('logo', { name: 'a.png', type: 'image/png', size: 1000 })).toBeNull()
    expect(checkAssetFile('logo', { name: 'a.svg', type: 'image/svg+xml', size: 1000 })).toBeNull()
    expect(checkAssetFile('favicon', { name: 'a.ico', type: '', size: 1000 })).toBeNull()
    expect(checkAssetFile('favicon', { name: 'a.png', type: 'image/png', size: 300 * 1024 })).toBe('too_large')
    expect(checkAssetFile('logo', { name: 'a.pdf', type: 'application/pdf', size: 10 })).toBe('unsupported_type')
    expect(checkAssetFile('logo', { name: 'a.png', type: 'image/png', size: 0 })).toBe('empty')
  })

  it('carries uploads in the reserved key, and only when there are some', () => {
    const upload = { filename: 'logo.png', base64: 'data:image/png;base64,AAAA' }
    const content = configDraftContent(CONFIG, { logo: upload })
    expect(content[ASSETS_KEY]).toEqual({ logo: upload })
    expect(splitConfigDraft(content)).toEqual({ config: CONFIG, uploads: { logo: upload } })
    expect(ASSETS_KEY in configDraftContent(content, {})).toBe(false)
  })
})
