// First run, after the admin account (server mode): organization, branding,
// anonymous read and the content repository status, saved as one direct
// commit of config.json by the new admin, or skipped.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Check, GitBranch, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { BrandHeading } from '@/components/layout/brand-heading'
import { submitErrorFrom } from '@/lib/drafts/submit-errors'
import { apiErrorCode } from '@/features/users/users-api'
import { getApiDraftStore, useDraftsStore } from '@/stores/drafts-store'
import { ColorField, ImageField, SwitchRow, ThemePreview } from '@/features/branding/branding-fields'
import { configDraftContent, type AssetKind, type AssetUpload } from '@/features/branding/branding-form'
import { loadRawConfig, refreshInstance } from '@/features/branding/config-source'
import { applySetupAnswers, setupAnswers, validateSetupAnswers, type SetupAnswers } from './setup-config'
import type { Config } from '@data-dictionary/format'
import type { GitStatus } from '@/lib/drafts/api-draft-store'

const STEPS = ['organization', 'branding', 'access', 'repository'] as const
type Step = (typeof STEPS)[number]

interface InstanceSetupProps {
  onDone: () => void
}

export function InstanceSetup({ onDone }: InstanceSetupProps) {
  const { t } = useTranslation()
  const saveDraft = useDraftsStore((s) => s.save)
  const discard = useDraftsStore((s) => s.discard)
  const [config, setConfig] = useState<Config | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<SetupAnswers | null>(null)
  const [logo, setLogo] = useState<AssetUpload | undefined>(undefined)
  const [git, setGit] = useState<GitStatus | null | 'loading'>('loading')
  const [step, setStep] = useState<Step>('organization')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadRawConfig()
      .then((c) => {
        if (cancelled) return
        setConfig(c)
        setAnswers(setupAnswers(c))
      })
      .catch((e) => {
        console.error('Could not load config.json', e)
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    getApiDraftStore()
      .then((store) => store.gitStatus())
      .then((status) => !cancelled && setGit(status))
      .catch(() => !cancelled && setGit(null))
    return () => {
      cancelled = true
    }
  }, [])

  const set = (patch: Partial<SetupAnswers>) => setAnswers((a) => (a ? { ...a, ...patch } : a))
  const index = STEPS.indexOf(step)
  const error = config && answers ? validateSetupAnswers(config, answers) : null

  const finish = async () => {
    if (!config || !answers || error) return
    setSaving(true)
    setSaveError(null)
    let draftId: string | null = null
    try {
      const uploads: Partial<Record<AssetKind, AssetUpload>> = logo ? { logo } : {}
      const draft = await saveDraft({ kind: 'config', targetId: null, content: configDraftContent(applySetupAnswers(config, answers), uploads) })
      draftId = draft.id
      await (await getApiDraftStore()).submit(draft.id, 'commit', 'Configure the instance')
      useDraftsStore.getState().forget(draft.id)
      await refreshInstance()
      onDone()
    } catch (e) {
      const submitError = submitErrorFrom(e)
      // Nothing to commit (every answer left as it was): done all the same.
      if (draftId && apiErrorCode(e) === 'no_changes') {
        await discard(draftId).catch(() => undefined)
        onDone()
        return
      }
      console.error('Could not save the instance configuration', e)
      setSaveError(submitError.message ?? t(`drafts.submit.error.${submitError.code}`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl space-y-6">
        <BrandHeading subtitle={t('setup.subtitle')} />
        <ol className="flex justify-center gap-2 text-[10px] text-muted-foreground" aria-label={t('setup.steps')}>
          {STEPS.map((s, i) => (
            <li key={s} className={i === index ? 'font-semibold text-foreground' : undefined}>
              {i + 1}. {t(`setup.${s}.label`)}
            </li>
          ))}
        </ol>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t(`setup.${step}.title`)}</CardTitle>
            <CardDescription className="text-xs">{t(`setup.${step}.description`)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadError && <NoticeBanner tone="danger" title={t('setup.load_error')} description={loadError} />}
            {!answers && !loadError && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
            {answers && step === 'organization' && (
              <>
                <FormField label={t('branding.organization.name')}>
                  {({ id }) => <Input id={id} value={answers.organizationName} onChange={(e) => set({ organizationName: e.target.value })} autoFocus />}
                </FormField>
                <FormField label={t('branding.organization.url')}>
                  {({ id }) => <Input id={id} type="url" value={answers.organizationUrl} onChange={(e) => set({ organizationUrl: e.target.value })} placeholder="https://" />}
                </FormField>
              </>
            )}
            {answers && step === 'branding' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t('branding.identity.instance_title')} required>
                    {({ id }) => <Input id={id} value={answers.title} onChange={(e) => set({ title: e.target.value })} />}
                  </FormField>
                  <FormField label={t('branding.identity.app_name')}>
                    {({ id }) => <Input id={id} value={answers.appName} onChange={(e) => set({ appName: e.target.value })} placeholder={answers.title} />}
                  </FormField>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField label={t('branding.colors.primary')} value={answers.primary} onChange={(primary) => set({ primary })} />
                  <ColorField label={t('branding.colors.secondary')} value={answers.secondary} onChange={(secondary) => set({ secondary })} />
                </div>
                <ThemePreview primary={answers.primary} secondary={answers.secondary} />
                <ImageField kind="logo" label={t('setup.branding.logo')} currentUrl={null} upload={logo} onUpload={setLogo} />
              </>
            )}
            {answers && step === 'access' && (
              <SwitchRow
                label={t('branding.display.anonymous_read')}
                hint={t('branding.display.anonymous_read_hint')}
                checked={answers.anonymousRead}
                onChange={(anonymousRead) => set({ anonymousRead })}
              />
            )}
            {step === 'repository' && <RepositoryStatus git={git} />}
            {error && step !== 'organization' && <NoticeBanner tone="danger" title={t(`branding.error.${error}`)} />}
            {saveError && <NoticeBanner tone="danger" title={t('setup.save_error')} description={saveError} />}
          </CardContent>
        </Card>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDone} disabled={saving}>
            {t('setup.skip')}
          </Button>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button variant="outline" onClick={() => setStep(STEPS[index - 1])} disabled={saving}>
                <ArrowLeft size={14} />
                {t('setup.back')}
              </Button>
            )}
            {index < STEPS.length - 1 ? (
              <Button onClick={() => setStep(STEPS[index + 1])} disabled={!answers}>
                {t('setup.next')}
                <ArrowRight size={14} />
              </Button>
            ) : (
              <Button onClick={() => void finish()} disabled={!answers || !!error || saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('setup.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RepositoryStatus({ git }: { git: GitStatus | null | 'loading' }) {
  const { t } = useTranslation()
  if (git === 'loading') return <Loader2 size={16} className="animate-spin text-muted-foreground" />
  return (
    <div className="space-y-3 text-xs">
      {git ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t('setup.repository.remote')}</dt>
          <dd className="break-all font-mono">{git.remote ?? t('setup.repository.none')}</dd>
          <dt className="text-muted-foreground">{t('setup.repository.branch')}</dt>
          <dd className="flex items-center gap-1 font-mono">
            <GitBranch size={12} />
            {git.branch}
          </dd>
          <dt className="text-muted-foreground">{t('setup.repository.head')}</dt>
          <dd className="font-mono">{git.head?.slice(0, 12)}</dd>
        </dl>
      ) : (
        <NoticeBanner tone="warning" title={t('setup.repository.unavailable')} />
      )}
      <p className="text-muted-foreground">{t('setup.repository.env')}</p>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[10px]">
        DD_CONTENT_REPO_URL=https://github.com/&lt;org&gt;/&lt;repo&gt;.git{'\n'}DD_CONTENT_BRANCH=main{'\n'}DD_GIT_TOKEN=…
      </pre>
    </div>
  )
}
