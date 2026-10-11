import { useState } from 'react'
import { brandingImageUrl } from '@/lib/config'
import { useInstanceConfig } from '@/stores/config-store'

interface BrandLogoProps {
  /** The text alternative when config.json gives no `logoAlt`. */
  fallbackAlt: string
  className?: string
}

/**
 * The instance logo, hidden when the image does not load: config.json may name
 * a file the content repository does not hold (a fresh fork, v1's layout), and a
 * broken image with its alt text would sit next to the app name.
 */
export function BrandLogo({ fallbackAlt, className }: BrandLogoProps) {
  const config = useInstanceConfig()
  const src = brandingImageUrl(config, 'logo')
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    <img
      src={src}
      alt={config.branding?.logoAlt ?? fallbackAlt}
      className={className}
      onError={() => setFailed(src)}
    />
  )
}
