import { describe, expect, it } from 'vitest'
import { brandingImageUrl } from './config'

describe('brandingImageUrl', () => {
  const config = { branding: { logo: 'branding/logo.png', favicon: 'https://cdn.example.org/f.ico' } }

  it('static mode: the path config.json names, under the base URL', () => {
    expect(brandingImageUrl(config, 'logo', false, '/dd/')).toBe('/dd/branding/logo.png')
    expect(brandingImageUrl({ branding: { logo: 'logo.png' } }, 'logo', false, '/')).toBe('/logo.png')
  })

  it('server mode: the API route serving the content repository image', () => {
    expect(brandingImageUrl(config, 'logo', true)).toBe('/api/v1/instance/branding/logo?v=branding%2Flogo.png')
  })

  it('absolute URLs pass through, a missing image is null', () => {
    expect(brandingImageUrl(config, 'favicon', true)).toBe('https://cdn.example.org/f.ico')
    expect(brandingImageUrl({}, 'logo', true)).toBeNull()
    expect(brandingImageUrl({ branding: { logo: ' ' } }, 'logo', false)).toBeNull()
  })
})
