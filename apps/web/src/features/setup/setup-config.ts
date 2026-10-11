import { applyBrandingForm, brandingForm, validateBrandingForm, type BrandingFormError } from '@/features/branding/branding-form'
import type { Config } from '@data-dictionary/format'

/** What the first-run wizard asks after the admin account. */
export interface SetupAnswers {
  organizationName: string
  organizationUrl: string
  title: string
  appName: string
  primary: string
  secondary: string
  anonymousRead: boolean
}

export function setupAnswers(config: Config): SetupAnswers {
  const form = brandingForm(config)
  return {
    organizationName: form.organizationName,
    organizationUrl: form.organizationUrl,
    title: form.title,
    appName: form.appName,
    primary: form.primary,
    secondary: form.secondary,
    anonymousRead: form.anonymousRead,
  }
}

/** `config` with the answers applied, everything else (languages, repository…) as it was. */
export function applySetupAnswers(config: Config, answers: SetupAnswers): Config {
  return applyBrandingForm(config, { ...brandingForm(config), ...answers })
}

export function validateSetupAnswers(config: Config, answers: SetupAnswers): BrandingFormError | null {
  return validateBrandingForm({ ...brandingForm(config), ...answers })
}
