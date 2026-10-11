import { appName } from '@/lib/config'
import { useInstanceConfig } from '@/stores/config-store'
import { BrandLogo } from './brand-logo'

interface BrandHeadingProps {
  /** Under the name, e.g. what the screen is for. */
  subtitle?: React.ReactNode
}

/** The instance logo and name, centred: the head of the login and setup screens. */
export function BrandHeading({ subtitle }: BrandHeadingProps) {
  const config = useInstanceConfig()
  const name = appName(config)
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <BrandLogo fallbackAlt={name} className="h-12 w-auto object-contain" />
      <h1 className="text-2xl font-bold text-foreground">{name}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
