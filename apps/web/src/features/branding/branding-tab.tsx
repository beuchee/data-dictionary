// Parity with legacy/general-settings.js, plus what v2 adds (colors, images,
// anonymous read). Saved as a `config` draft; images ride in its `$assets`.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitPullRequest, Loader2, Plus, Save, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isServerMode } from '@/lib/api-client'
import { brandingImageUrl } from '@/lib/config'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { contentEqual } from '@/lib/drafts/diff'
import { findDraft } from '@/lib/drafts/overlay'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { useUnsavedChangesGuard } from '@/features/drafts/unsaved-changes'
import { ColorField, ImageField, SwitchRow, ThemePreview } from './branding-fields'
import {
  applyBrandingForm,
  brandingForm,
  configDraftContent,
  isLanguageCode,
  splitConfigDraft,
  validateBrandingForm,
  type AssetKind,
  type AssetUpload,
  type BrandingForm,
  type ConfigDraftContent,
} from './branding-form'
import { loadRawConfig, refreshInstance } from './config-source'
import type { Config } from '@data-dictionary/format'

type Uploads = Partial<Record<AssetKind, AssetUpload>>

export function BrandingTab() {
  const { t } = useTranslation()
  const instance = useInstanceConfig()
  const user = useAuthStore((s) => s.user)
  const drafts = useDraftsStore((s) => s.drafts)
  const loadDrafts = useDraftsStore((s) => s.load)
  const saveDraft = useDraftsStore((s) => s.save)
  const discard = useDraftsStore((s) => s.discard)
  const [base, setBase] = useState<{ status: 'loading' } | { status: 'ready'; config: Config } | { status: 'error'; error: string }>({
    status: 'loading',
  })
  const [generation, setGeneration] = useState(0)
  const draft = findDraft(drafts, 'config', null)
  const mayEdit = canEdit('config', (p) => userHasPermission(user, p))

  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])
  useEffect(() => {
    let cancelled = false
    loadRawConfig()
      .then((config) => !cancelled && setBase({ status: 'ready', config }))
      .catch((e) => {
        console.error('Could not load config.json', e)
        if (!cancelled) setBase({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [generation])

  if (base.status === 'loading') {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (base.status === 'error') return <NoticeBanner tone="danger" title={t('branding.load_error')} description={base.error} />

  const shown: ConfigDraftContent = (draft?.content as ConfigDraftContent | undefined) ?? base.config
  return (
    <BrandingEditor
      // A new draft or a reloaded repository config starts the form over.
      key={`${draft?.id ?? 'repo'}:${draft?.updatedAt ?? generation}`}
      initial={shown}
      instanceLogo={brandingImageUrl(instance, 'logo')}
      instanceFavicon={brandingImageUrl(instance, 'favicon')}
      mayEdit={mayEdit}
      draftToolbar={
        <DraftActions
          hasDraft={!!draft}
          onDiscard={() => draft && discard(draft.id).catch((e) => console.error('Could not discard the draft', e))}
          submitDialog={(open, setOpen) => (
            <SubmitDialog
              open={open}
              onOpenChange={setOpen}
              draft={draft ?? null}
              onSubmitted={(result) => {
                setGeneration((g) => g + 1)
                if (result.mode === 'commit') void refreshInstance()
              }}
            />
          )}
        />
      }
      onSave={async (content) => {
        await saveDraft({ kind: 'config', targetId: null, content })
      }}
    />
  )
}

interface DraftActionsProps {
  hasDraft: boolean
  onDiscard: () => void
  submitDialog: (open: boolean, setOpen: (open: boolean) => void) => React.ReactNode
}

function DraftActions({ hasDraft, onDiscard, submitDialog }: DraftActionsProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const [submitOpen, setSubmitOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  if (!hasDraft) return null
  return (
    <>
      <Badge variant="outline" className="border-primary/50 text-primary">
        {isServerMode() ? t('drafts.badge_server') : t('drafts.badge')}
      </Badge>
      <Button size="sm" variant="outline" onClick={() => setDiscardOpen(true)}>
        <Undo2 size={14} />
        {t('drafts.discard_button')}
      </Button>
      <Button size="sm" onClick={() => setSubmitOpen(true)}>
        <GitPullRequest size={14} />
        {isServerMode() ? t('drafts.submit_button') : t('drafts.propose_button', { forge: forgeName(repositoryConfig(config)) })}
      </Button>
      {submitDialog(submitOpen, setSubmitOpen)}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('drafts.discard.title')}
        description={t('drafts.discard.description', { name: t('drafts.kind.config') })}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() => {
          setDiscardOpen(false)
          onDiscard()
        }}
      />
    </>
  )
}

interface BrandingEditorProps {
  initial: ConfigDraftContent
  instanceLogo: string | null
  instanceFavicon: string | null
  mayEdit: boolean
  draftToolbar: React.ReactNode
  onSave: (content: ConfigDraftContent) => Promise<void>
}

const COMMON_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'fi', 'pl', 'cs', 'el']

function BrandingEditor({ initial, instanceLogo, instanceFavicon, mayEdit, draftToolbar, onSave }: BrandingEditorProps) {
  const { t } = useTranslation()
  const { config: initialConfig, uploads: initialUploads } = splitConfigDraft(initial)
  const [form, setForm] = useState<BrandingForm>(() => brandingForm(initialConfig))
  const [uploads, setUploads] = useState<Uploads>(initialUploads)
  const [newLanguage, setNewLanguage] = useState('')
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const next = configDraftContent(applyBrandingForm(initialConfig, form), uploads)
  const dirty = !contentEqual(initial, next)
  const error = validateBrandingForm(form)
  const { dialog } = useUnsavedChangesGuard(dirty)
  const set = (patch: Partial<BrandingForm>) => setForm((f) => ({ ...f, ...patch }))
  const disabled = !mayEdit

  const save = async () => {
    setTried(true)
    if (error || !dirty) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(next)
    } catch (e) {
      console.error('Could not save the configuration draft', e)
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setForm(brandingForm(initialConfig))
    setUploads(initialUploads)
    setTried(false)
  }

  const addLanguage = () => {
    const code = newLanguage.trim()
    if (!isLanguageCode(code) || form.languages.includes(code)) return
    set({ languages: [...form.languages, code] })
    setNewLanguage('')
  }

  // The image the instance shows now, when this config names one.
  const imageUrl = (kind: AssetKind, current: string | null) => (initialConfig.branding?.[kind] ? current : null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {draftToolbar}
        {mayEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={reset} disabled={!dirty || saving}>
              <X size={14} />
              {t('branding.reset')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving || (tried && !!error)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t('branding.save')}
            </Button>
          </>
        )}
      </div>
      {!mayEdit && <NoticeBanner tone="warning" title={t('branding.read_only')} />}
      {tried && error && <NoticeBanner tone="danger" title={t(`branding.error.${error}`)} />}
      {saveError && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={saveError} />}

      <fieldset disabled={disabled} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('branding.identity.title')}</CardTitle>
            <CardDescription className="text-xs">{t('branding.identity.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('branding.identity.instance_title')} required hint={t('branding.identity.instance_title_hint')} hintInTooltip>
                {({ id }) => <Input id={id} value={form.title} onChange={(e) => set({ title: e.target.value })} />}
              </FormField>
              <FormField label={t('branding.identity.app_name')} hint={t('branding.identity.app_name_hint')} hintInTooltip>
                {({ id }) => <Input id={id} value={form.appName} onChange={(e) => set({ appName: e.target.value })} placeholder={form.title} />}
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageField
                kind="logo"
                label={t('branding.images.logo')}
                currentUrl={imageUrl('logo', instanceLogo)}
                upload={uploads.logo}
                onUpload={(u) => setUploads((x) => ({ ...x, logo: u }))}
                disabledReason={!isServerMode() ? t('branding.images.static_mode') : disabled ? t('branding.read_only') : undefined}
              />
              <ImageField
                kind="favicon"
                label={t('branding.images.favicon')}
                currentUrl={imageUrl('favicon', instanceFavicon)}
                upload={uploads.favicon}
                onUpload={(u) => setUploads((x) => ({ ...x, favicon: u }))}
                disabledReason={!isServerMode() ? t('branding.images.static_mode') : disabled ? t('branding.read_only') : undefined}
              />
            </div>
            <FormField label={t('branding.identity.logo_alt')}>
              {({ id }) => <Input id={id} value={form.logoAlt} onChange={(e) => set({ logoAlt: e.target.value })} />}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('branding.colors.title')}</CardTitle>
            <CardDescription className="text-xs">{t('branding.colors.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label={t('branding.colors.primary')} value={form.primary} onChange={(primary) => set({ primary })} />
              <ColorField label={t('branding.colors.secondary')} value={form.secondary} onChange={(secondary) => set({ secondary })} />
            </div>
            <ThemePreview primary={form.primary} secondary={form.secondary} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('branding.languages.title')}</CardTitle>
            <CardDescription className="text-xs">{t('branding.languages.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {form.languages.map((code) => (
                <Badge key={code} variant="secondary" className="gap-1 font-mono">
                  {code}
                  <button
                    type="button"
                    aria-label={t('branding.languages.remove', { code })}
                    disabled={form.languages.length <= 1}
                    onClick={() => set({ languages: form.languages.filter((l) => l !== code) })}
                    className="rounded-sm hover:text-destructive disabled:opacity-40"
                  >
                    <X size={10} />
                  </button>
                </Badge>
              ))}
              <Input
                value={newLanguage}
                onChange={(e) => setNewLanguage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addLanguage()
                  }
                }}
                list="dd-branding-languages"
                placeholder={t('branding.languages.add_placeholder')}
                className="h-7 w-28 font-mono"
                aria-label={t('branding.languages.add')}
              />
              <datalist id="dd-branding-languages">
                {COMMON_LANGUAGES.filter((l) => !form.languages.includes(l)).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <Button size="xs" variant="outline" onClick={addLanguage} disabled={!isLanguageCode(newLanguage.trim())}>
                <Plus size={12} />
                {t('branding.languages.add')}
              </Button>
            </div>
            <FormField label={t('branding.languages.default')}>
              {({ id }) => (
                <Select value={form.defaultLanguage} onValueChange={(defaultLanguage) => set({ defaultLanguage })}>
                  <SelectTrigger id={id} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {form.languages.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('branding.organization.title')}</CardTitle>
            <CardDescription className="text-xs">{t('branding.organization.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('branding.organization.name')}>
              {({ id }) => <Input id={id} value={form.organizationName} onChange={(e) => set({ organizationName: e.target.value })} />}
            </FormField>
            <FormField label={t('branding.organization.url')}>
              {({ id }) => <Input id={id} type="url" value={form.organizationUrl} onChange={(e) => set({ organizationUrl: e.target.value })} placeholder="https://" />}
            </FormField>
            <FormField label={t('branding.vocabulary.id')} hint={t('branding.vocabulary.hint')} hintInTooltip>
              {({ id }) => <Input id={id} value={form.vocabularyId} onChange={(e) => set({ vocabularyId: e.target.value })} className="font-mono" />}
            </FormField>
            <FormField label={t('branding.vocabulary.prefix')}>
              {({ id }) => <Input id={id} value={form.vocabularyPrefix} onChange={(e) => set({ vocabularyPrefix: e.target.value })} className="font-mono" />}
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('branding.display.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SwitchRow label={t('branding.display.show_projects')} checked={form.showProjects} onChange={(showProjects) => set({ showProjects })} />
            <SwitchRow
              label={t('branding.display.show_mapping')}
              checked={form.showMappingRecommendations}
              onChange={(showMappingRecommendations) => set({ showMappingRecommendations })}
            />
            <SwitchRow
              label={t('branding.display.anonymous_read')}
              hint={t('branding.display.anonymous_read_hint')}
              checked={form.anonymousRead}
              onChange={(anonymousRead) => set({ anonymousRead })}
            />
          </CardContent>
        </Card>
      </fieldset>
      {dialog}
    </div>
  )
}
