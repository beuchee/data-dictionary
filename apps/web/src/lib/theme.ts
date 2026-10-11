import { appName, assetUrl, type InstanceConfig } from '@/lib/config'

export interface Rgb {
  /** 0–255 per channel; may fall outside that range for a color out of the sRGB gamut. */
  r: number
  g: number
  b: number
}

export interface Oklch {
  /** Perceived lightness, 0–1. */
  l: number
  /** Chroma, 0 to ~0.37 within sRGB. */
  c: number
  /** Hue angle in degrees, 0–360. Meaningless (0) when chroma is ~0. */
  h: number
}

export type CssVariables = Record<string, string>

export interface ThemeVariables {
  light: CssVariables
  dark: CssVariables
}

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
// The app's own --foreground (slate-950), so dark text on a brand color matches body text.
const NEAR_BLACK_OKLCH: Oklch = { l: 0.129, c: 0.042, h: 264.695 }
// index.css `.dark --background`: what a dark-mode primary is read against as link/text color.
const DARK_BACKGROUND_OKLCH: Oklch = { l: 0.129, c: 0.042, h: 264.695 }

// Lightness a derived dark-mode color starts from, and the ceiling of the search.
const DARK_MIN_LIGHTNESS = 0.72
const DARK_MAX_LIGHTNESS = 0.97

// ---------------------------------------------------------------------------
// Parsing and conversions
// ---------------------------------------------------------------------------

/** `#rgb` or `#rrggbb` (the `#` optional, any case). `null` for anything else. */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (typeof input !== 'string') return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join('') : m[1]
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

// sRGB transfer function (IEC 61966-2-1).
function toLinear(channel255: number): number {
  const c = channel255 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  return c * 255
}

// OKLab matrices from Björn Ottosson, https://bottosson.github.io/posts/oklab/
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  let h = c < 1e-4 ? 0 : (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

/** Unclamped: check `inSrgbGamut` before using the result as a real color. */
export function oklchToRgb({ l: L, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

export function inSrgbGamut({ r, g, b }: Rgb, tolerance = 0.5): boolean {
  return [r, g, b].every((v) => v >= -tolerance && v <= 255 + tolerance)
}

function clampRgb({ r, g, b }: Rgb): Rgb {
  const clamp = (v: number) => Math.min(255, Math.max(0, v))
  return { r: clamp(r), g: clamp(g), b: clamp(b) }
}

/** Keep lightness and hue, lower chroma until the color fits in sRGB. */
export function fitToGamut(color: Oklch): Oklch {
  if (inSrgbGamut(oklchToRgb(color))) return color
  let lo = 0
  let hi = color.c
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inSrgbGamut(oklchToRgb({ ...color, c: mid }))) lo = mid
    else hi = mid
  }
  return { ...color, c: lo }
}

export function formatOklch({ l, c, h }: Oklch): string {
  const round = (v: number, digits: number) => Number(v.toFixed(digits))
  return `oklch(${round(l, 4)} ${round(c, 4)} ${c < 1e-4 ? 0 : round(h, 2)})`
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.x)
// ---------------------------------------------------------------------------

export function relativeLuminance(rgb: Rgb): number {
  const { r, g, b } = clampRgb(rgb)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Text color for content drawn on `background`: white or the app's near-black,
 * whichever contrasts more. Near-black is a little lighter than black, so for a
 * mid-luminance color where neither reaches AA, pure black is used: one of white
 * and black always clears 4.5 (the worst case, at luminance ~0.18, is ~4.58).
 */
export function readableForeground(background: Rgb): { rgb: Rgb; css: string } {
  const nearBlack = oklchToRgb(NEAR_BLACK_OKLCH)
  const candidates = [
    { rgb: WHITE, css: 'oklch(1 0 0)' },
    { rgb: nearBlack, css: formatOklch(NEAR_BLACK_OKLCH) },
  ].map((c) => ({ ...c, ratio: contrastRatio(background, c.rgb) }))
  const best = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a))
  if (best.ratio >= MIN_CONTRAST) return { rgb: best.rgb, css: best.css }
  return { rgb: BLACK, css: 'oklch(0 0 0)' }
}

/**
 * The dark-mode counterpart of a brand color: same hue, raised to at least
 * DARK_MIN_LIGHTNESS and further until it reads as text on the dark background,
 * with chroma lowered only as much as the sRGB gamut requires.
 */
export function deriveDarkVariant(color: Rgb): Oklch {
  const base = rgbToOklch(color)
  const background = oklchToRgb(DARK_BACKGROUND_OKLCH)
  let candidate = fitToGamut({ ...base, l: Math.max(base.l, DARK_MIN_LIGHTNESS) })
  while (
    contrastRatio(oklchToRgb(candidate), background) < MIN_CONTRAST &&
    candidate.l < DARK_MAX_LIGHTNESS
  ) {
    candidate = fitToGamut({ ...base, l: Math.min(DARK_MAX_LIGHTNESS, candidate.l + 0.02) })
  }
  return candidate
}

// ---------------------------------------------------------------------------
// CSS custom properties
// ---------------------------------------------------------------------------

/**
 * The customisable brand roles. `accent` is deliberately not one: in shadcn it is
 * the hover surface of menus and ghost buttons, so a saturated brand color there
 * tints every hover. It stays the neutral token of index.css; a `colors.accent`
 * key in config.json is accepted and ignored.
 */
type Role = 'primary' | 'secondary'

// Tokens each brand color drives, beyond `--<role>` and `--<role>-foreground`.
const EXTRA_TOKENS: Record<Role, { color: string[]; foreground: string[] }> = {
  primary: {
    color: ['--ring', '--sidebar-primary', '--sidebar-ring'],
    foreground: ['--sidebar-primary-foreground'],
  },
  secondary: { color: [], foreground: [] },
}

const ROLES: Role[] = ['primary', 'secondary']

function roleVariables(role: Role, color: Oklch): CssVariables {
  const rgb = clampRgb(oklchToRgb(color))
  const value = formatOklch(color)
  const foreground = readableForeground(rgb).css
  const vars: CssVariables = { [`--${role}`]: value, [`--${role}-foreground`]: foreground }
  for (const token of EXTRA_TOKENS[role].color) vars[token] = value
  for (const token of EXTRA_TOKENS[role].foreground) vars[token] = foreground
  return vars
}

/**
 * The CSS custom properties to override for the instance's brand colors. A color
 * that is absent or not a valid hex leaves its tokens untouched (index.css defaults).
 * Dark mode uses `darkColors.<role>` when given, otherwise a variant derived from
 * `colors.<role>`.
 */
export function themeVariables(branding: InstanceConfig['branding']): ThemeVariables {
  const light: CssVariables = {}
  const dark: CssVariables = {}
  for (const role of ROLES) {
    const base = parseHex(branding?.colors?.[role])
    const explicitDark = parseHex(branding?.darkColors?.[role])
    if (base) Object.assign(light, roleVariables(role, rgbToOklch(base)))
    const darkColor = explicitDark ? rgbToOklch(explicitDark) : base ? deriveDarkVariant(base) : null
    if (darkColor) Object.assign(dark, roleVariables(role, darkColor))
  }
  return { light, dark }
}

/**
 * A stylesheet setting `vars` for light and dark mode. Doubled selectors outrank
 * index.css's `:root` / `.dark` whatever order the two stylesheets load in.
 */
export function themeStylesheet({ light, dark }: ThemeVariables): string {
  const block = (selector: string, vars: CssVariables) => {
    const entries = Object.entries(vars)
    if (entries.length === 0) return ''
    return `${selector} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`
  }
  return block(':root:root', light) + block(':root.dark', dark)
}

const BRANDING_STYLE_ID = 'dd-branding'

/** Applies the instance branding to the document: color tokens, title, favicon. */
export function applyBranding(config: InstanceConfig, doc: Document = document): void {
  let style = doc.getElementById(BRANDING_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = BRANDING_STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = themeStylesheet(themeVariables(config.branding))

  doc.title = appName(config)

  const favicon = assetUrl(config.branding?.favicon)
  if (favicon) {
    let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!link) {
      link = doc.createElement('link')
      link.rel = 'icon'
      doc.head.appendChild(link)
    }
    link.href = favicon
  }
}
