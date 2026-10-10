import { describe, expect, it } from 'vitest'
import type { InstanceConfig } from '@/lib/config'
import { BOTTOM_NAV_ITEMS, activeNavItem, mainNavItems } from './nav-items'

const base: InstanceConfig = { title: 'T', languages: ['en'], defaultLanguage: 'en' }
const paths = (config: InstanceConfig) => mainNavItems(config).map((i) => i.path)

describe('mainNavItems', () => {
  it('shows every tab when the config says nothing', () => {
    expect(paths(base)).toEqual(['/concept-sets', '/projects', '/mapping'])
  })

  it('honours config.tabs', () => {
    expect(paths({ ...base, tabs: { showProjects: false } })).toEqual(['/concept-sets', '/mapping'])
    expect(paths({ ...base, tabs: { showMappingRecommendations: false } })).toEqual(['/concept-sets', '/projects'])
  })
})

describe('activeNavItem', () => {
  it('matches a sub-route but not a lookalike prefix', () => {
    expect(activeNavItem('/settings/units', BOTTOM_NAV_ITEMS)?.path).toBe('/settings')
    expect(activeNavItem('/settings', BOTTOM_NAV_ITEMS)?.path).toBe('/settings')
    expect(activeNavItem('/settingsx', BOTTOM_NAV_ITEMS)).toBeUndefined()
  })
})
