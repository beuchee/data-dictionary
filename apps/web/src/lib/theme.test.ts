import { describe, expect, it } from 'vitest'
import {
  MIN_CONTRAST,
  contrastRatio,
  deriveDarkVariant,
  fitToGamut,
  formatOklch,
  inSrgbGamut,
  oklchToRgb,
  parseHex,
  readableForeground,
  rgbToOklch,
  themeStylesheet,
  themeVariables,
  type Oklch,
} from './theme'

const hex = (s: string) => {
  const rgb = parseHex(s)
  if (!rgb) throw new Error(`bad fixture ${s}`)
  return rgb
}

// Dark --background from index.css.
const DARK_BG = oklchToRgb({ l: 0.129, c: 0.042, h: 264.695 })

describe('parseHex', () => {
  it('reads 6-digit hex, with or without #, any case', () => {
    expect(parseHex('#1f6feb')).toEqual({ r: 0x1f, g: 0x6f, b: 0xeb })
    expect(parseHex('1F6FEB')).toEqual({ r: 0x1f, g: 0x6f, b: 0xeb })
    expect(parseHex('  #ffffff ')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('expands 3-digit hex', () => {
    expect(parseHex('#f80')).toEqual({ r: 0xff, g: 0x88, b: 0x00 })
    expect(parseHex('abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  it.each(['', '#', '#ff', '#ffff', '#fffffff', '#ggg', 'red', 'rgb(0,0,0)', '#12345g'])(
    'rejects %j',
    (input) => {
      expect(parseHex(input)).toBeNull()
    },
  )

  it('rejects non-strings', () => {
    expect(parseHex(undefined)).toBeNull()
    expect(parseHex(null)).toBeNull()
    expect(parseHex(123 as unknown as string)).toBeNull()
  })
})

describe('rgbToOklch', () => {
  // Reference values: CSS Color 4 / Ottosson's reference implementation.
  it.each<[string, Oklch]>([
    ['#ffffff', { l: 1, c: 0, h: 0 }],
    ['#000000', { l: 0, c: 0, h: 0 }],
    ['#ff0000', { l: 0.62796, c: 0.25768, h: 29.234 }],
    ['#00ff00', { l: 0.86644, c: 0.29483, h: 142.495 }],
    ['#0000ff', { l: 0.45201, c: 0.31321, h: 264.052 }],
  ])('converts %s', (input, expected) => {
    const actual = rgbToOklch(hex(input))
    expect(actual.l).toBeCloseTo(expected.l, 3)
    expect(actual.c).toBeCloseTo(expected.c, 3)
    if (expected.c > 0) expect(actual.h).toBeCloseTo(expected.h, 1)
    else expect(actual.h).toBe(0)
  })

  it('reports grays as achromatic', () => {
    const gray = rgbToOklch(hex('#808080'))
    expect(gray.c).toBeLessThan(1e-4)
    expect(gray.h).toBe(0)
  })

  it('round-trips through oklchToRgb', () => {
    for (const input of ['#1f6feb', '#6e40c9', '#2ea44f', '#f80', '#123456']) {
      const rgb = hex(input)
      const back = oklchToRgb(rgbToOklch(rgb))
      expect(back.r).toBeCloseTo(rgb.r, 3)
      expect(back.g).toBeCloseTo(rgb.g, 3)
      expect(back.b).toBeCloseTo(rgb.b, 3)
    }
  })
})

describe('formatOklch', () => {
  it('formats as a CSS oklch() value', () => {
    expect(formatOklch({ l: 0.627955, c: 0.257683, h: 29.2338 })).toBe('oklch(0.628 0.2577 29.23)')
    expect(formatOklch({ l: 1, c: 0.00001, h: 120 })).toBe('oklch(1 0 0)')
  })
})

describe('contrastRatio', () => {
  // Reference values from the WCAG definition (and WebAIM's checker).
  it.each<[string, string, number]>([
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#ffffff', 1],
    ['#767676', '#ffffff', 4.54],
    ['#777777', '#ffffff', 4.48],
    ['#0000ff', '#ffffff', 8.59],
    ['#ff0000', '#ffffff', 4.0],
  ])('%s vs %s ≈ %d', (a, b, expected) => {
    expect(contrastRatio(hex(a), hex(b))).toBeCloseTo(expected, 2)
  })

  it('is symmetric', () => {
    expect(contrastRatio(hex('#1f6feb'), hex('#fff'))).toBe(contrastRatio(hex('#fff'), hex('#1f6feb')))
  })
})

describe('readableForeground', () => {
  it('puts white on a dark brand color', () => {
    expect(readableForeground(hex('#1f3a93')).css).toBe('oklch(1 0 0)')
    expect(readableForeground(hex('#000')).css).toBe('oklch(1 0 0)')
  })

  it('puts near-black on a light brand color', () => {
    const fg = readableForeground(hex('#ffd54f'))
    expect(fg.css).toBe('oklch(0.129 0.042 264.69)')
  })

  it('falls back to pure black where neither white nor near-black reaches AA', () => {
    // Luminance ~0.18: the crossover point, where white gives ~4.4.
    const fg = readableForeground(hex('#777777'))
    expect(contrastRatio(hex('#777777'), fg.rgb)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('always meets AA', () => {
    for (let v = 0; v <= 255; v += 5) {
      for (const color of [{ r: v, g: v, b: v }, { r: v, g: 0, b: 255 - v }, { r: 255, g: v, b: 0 }]) {
        const fg = readableForeground(color)
        expect(contrastRatio(color, fg.rgb)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    }
  })
})

describe('fitToGamut', () => {
  it('leaves in-gamut colors alone', () => {
    const red = rgbToOklch(hex('#ff0000'))
    expect(fitToGamut(red)).toEqual(red)
  })

  it('lowers chroma only, until in gamut', () => {
    const wild: Oklch = { l: 0.9, c: 0.35, h: 264 }
    expect(inSrgbGamut(oklchToRgb(wild))).toBe(false)
    const fitted = fitToGamut(wild)
    expect(inSrgbGamut(oklchToRgb(fitted))).toBe(true)
    expect(fitted.l).toBe(wild.l)
    expect(fitted.h).toBe(wild.h)
    expect(fitted.c).toBeLessThan(wild.c)
    expect(fitted.c).toBeGreaterThan(0)
  })
})

describe('deriveDarkVariant', () => {
  it.each(['#1f6feb', '#6e40c9', '#2ea44f', '#0000ff', '#000000', '#7f1d1d', '#ffd54f', '#ffffff'])(
    '%s stays in gamut and reads on the dark background',
    (input) => {
      const dark = deriveDarkVariant(hex(input))
      const rgb = oklchToRgb(dark)
      expect(inSrgbGamut(rgb)).toBe(true)
      expect(contrastRatio(rgb, DARK_BG)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(contrastRatio(rgb, readableForeground(rgb).rgb)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    },
  )

  it('keeps the hue of a chromatic color', () => {
    const base = rgbToOklch(hex('#1f6feb'))
    const dark = deriveDarkVariant(hex('#1f6feb'))
    expect(dark.h).toBeCloseTo(base.h, 6)
    expect(dark.l).toBeGreaterThan(base.l)
  })

  it('keeps a color that is already light enough', () => {
    const base = rgbToOklch(hex('#ffd54f'))
    expect(deriveDarkVariant(hex('#ffd54f')).l).toBeCloseTo(base.l, 6)
  })
})

describe('themeVariables', () => {
  it('overrides nothing when no colors are configured', () => {
    expect(themeVariables(undefined)).toEqual({ light: {}, dark: {} })
    expect(themeVariables({ logo: 'logo.png' })).toEqual({ light: {}, dark: {} })
    expect(themeVariables({ colors: {} })).toEqual({ light: {}, dark: {} })
  })

  it('ignores invalid colors', () => {
    expect(themeVariables({ colors: { primary: 'blue', accent: '#12' } })).toEqual({ light: {}, dark: {} })
  })

  it('maps primary to its tokens, ring and sidebar included', () => {
    const { light, dark } = themeVariables({ colors: { primary: '#1f6feb' } })
    expect(Object.keys(light).sort()).toEqual(
      [
        '--primary',
        '--primary-foreground',
        '--ring',
        '--sidebar-primary',
        '--sidebar-primary-foreground',
        '--sidebar-ring',
      ].sort(),
    )
    expect(light['--primary']).toBe(formatOklch(rgbToOklch(hex('#1f6feb'))))
    expect(light['--ring']).toBe(light['--primary'])
    expect(light['--sidebar-primary-foreground']).toBe(light['--primary-foreground'])
    expect(light['--primary-foreground']).toBe('oklch(1 0 0)')
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
    expect(dark['--primary']).toBe(formatOklch(deriveDarkVariant(hex('#1f6feb'))))
  })

  it('maps secondary to its own pair only', () => {
    const { light } = themeVariables({ colors: { secondary: '#6e40c9' } })
    expect(Object.keys(light).sort()).toEqual(['--secondary', '--secondary-foreground'])
  })

  it('ignores accent: it stays the neutral hover surface', () => {
    expect(themeVariables({ colors: { accent: '#2ea44f' }, darkColors: { accent: '#58a6ff' } })).toEqual({
      light: {},
      dark: {},
    })
    const { light } = themeVariables({ colors: { primary: '#1f6feb', accent: '#2ea44f' } })
    expect(Object.keys(light).some((k) => k.startsWith('--accent'))).toBe(false)
  })

  it('uses darkColors when given instead of deriving', () => {
    const { light, dark } = themeVariables({
      colors: { primary: '#1f6feb' },
      darkColors: { primary: '#58a6ff' },
    })
    expect(dark['--primary']).toBe(formatOklch(rgbToOklch(hex('#58a6ff'))))
    expect(light['--primary']).toBe(formatOklch(rgbToOklch(hex('#1f6feb'))))
  })

  it('applies a darkColors entry even without a light color', () => {
    const { light, dark } = themeVariables({ darkColors: { secondary: '#58a6ff' } })
    expect(light).toEqual({})
    expect(Object.keys(dark).sort()).toEqual(['--secondary', '--secondary-foreground'])
  })
})

describe('themeStylesheet', () => {
  it('is empty when there is nothing to override', () => {
    expect(themeStylesheet({ light: {}, dark: {} })).toBe('')
  })

  it('writes one block per mode', () => {
    const css = themeStylesheet({ light: { '--primary': 'oklch(0.5 0.1 200)' }, dark: { '--primary': 'oklch(0.8 0.1 200)' } })
    expect(css).toBe(':root:root {\n  --primary: oklch(0.5 0.1 200);\n}\n:root.dark {\n  --primary: oklch(0.8 0.1 200);\n}\n')
  })
})
