import { describe, expect, it } from 'vitest'
import { bumpVersion, compareVersions, isValidVersion, newVersionProblem, parseVersion } from './semver'

describe('semver', () => {
  it('parses X.Y.Z only', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion(' 10.0.1 ')).toEqual([10, 0, 1])
    for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '01.2.3', '1.2.x', '']) expect(isValidVersion(bad)).toBe(false)
  })

  it('bumps and resets the lower parts', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(bumpVersion('garbage', 'minor')).toBe('1.1.0')
  })

  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })

  it('refuses invalid, non-increasing and already published versions', () => {
    expect(newVersionProblem('1.1', '1.0.0', [])).toBe('invalid')
    expect(newVersionProblem('1.0.0', '1.0.0', ['1.0.0'])).toBe('taken')
    expect(newVersionProblem('0.9.0', '1.0.0', ['1.0.0'])).toBe('not_greater')
    // Published earlier then rolled back: still never reused.
    expect(newVersionProblem('1.2.0', '1.1.0', ['1.0.0', '1.1.0', '1.2.0'])).toBe('taken')
    expect(newVersionProblem('1.1.0', '1.0.0', ['1.0.0'])).toBeNull()
  })
})
