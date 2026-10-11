import { useTranslation } from 'react-i18next'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { formatBytes } from './format'

interface AthenaFileListProps {
  files: File[]
  /** Required tables the folder lacks. */
  missing: string[]
}

/** The ATHENA files picked for an import, with what is missing. */
export function AthenaFileList({ files, missing }: AthenaFileListProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="max-h-48 divide-y overflow-auto rounded-md border">
          {files.map((f) => (
            <li key={f.name} className="flex justify-between gap-2 px-3 py-1 text-xs">
              <span className="truncate font-mono">{f.name}</span>
              <span className="tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <NoticeBanner
          tone="warning"
          title={t('vocabulary.missing_tables', { tables: missing.map((m) => m.toUpperCase()).join(', ') })}
        />
      )}
    </div>
  )
}
