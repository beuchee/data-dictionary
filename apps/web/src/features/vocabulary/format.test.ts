import { describe, expect, it } from 'vitest'
import { athenaUrl, formatBytes, percent } from './format'

describe('formatBytes', () => {
  it('scales by 1024 with one decimal below 10', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB')
  })

  it('shows nothing for a missing or invalid size', () => {
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})

describe('percent', () => {
  it('clamps and survives an unknown total', () => {
    expect(percent(1, 4)).toBe(25)
    expect(percent(5, 4)).toBe(100)
    expect(percent(1, 0)).toBe(0)
  })
})

it('links a concept to Athena', () => {
  expect(athenaUrl(3027018)).toBe('https://athena.ohdsi.org/search-terms/terms/3027018')
})
