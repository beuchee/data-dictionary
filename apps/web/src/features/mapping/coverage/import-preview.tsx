import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'
import type { MappingFormat, MappingRow } from '@/lib/mapping-import/types'
import type { ImportModel } from './import-model'

interface ImportPreviewProps {
  model: ImportModel
  format: MappingFormat
}

const ROW_FIELDS: (keyof MappingRow)[] = [
  'sourceVocabularyId',
  'sourceCode',
  'sourceName',
  'sourceConceptId',
  'targetConceptId',
  'equivalence',
  'status',
  'frequency',
]

function PreviewGrid({ headers, rows }: { headers: string[]; rows: (string | number | undefined)[][] }) {
  return (
    <div className="max-h-[260px] overflow-auto rounded border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="w-10 border-b border-r px-2 py-1.5 text-center font-medium text-muted-foreground">#</th>
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-muted/50">
              <td className="border-b border-r px-2 py-1 text-center tabular-nums text-muted-foreground">{i + 1}</td>
              {headers.map((h, j) => (
                <td key={h} className="max-w-[220px] truncate whitespace-nowrap border-b px-2 py-1">
                  {r[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The file as read (table formats), then what the parser makes of it: counts, warnings, first rows. */
export function ImportPreview({ model, format }: ImportPreviewProps) {
  const { t } = useTranslation()
  const { preview, result } = model
  const fields = ROW_FIELDS.filter((f) => result?.rows.some((r) => r[f] !== undefined))

  return (
    <div className="flex flex-col gap-3">
      {preview && (
        <div className="flex flex-col gap-1">
          <SectionLabel>{t('coverage.preview_file')}</SectionLabel>
          <PreviewGrid headers={preview.headers} rows={preview.rows} />
          <p className="text-[10px] text-muted-foreground">
            {t('coverage.preview_hint', { shown: preview.rows.length, total: preview.total.toLocaleString() })}
          </p>
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-1">
          <SectionLabel>{t('coverage.preview_parsed', { format: t(`coverage.formats.${format}`) })}</SectionLabel>
          <p className="text-xs">
            {t('coverage.parsed_summary', {
              read: result.stats.totalRows.toLocaleString(),
              mapped: result.stats.mappedRows.toLocaleString(),
              unmapped: result.stats.unmappedRows.toLocaleString(),
              skipped: result.stats.skippedRows.toLocaleString(),
              targets: result.stats.uniqueTargets.toLocaleString(),
            })}
          </p>
          {result.warnings.map((w) => (
            <p key={w.code} className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              {t(`coverage.warnings.${w.code}`, { count: w.count, rows: w.rows.join(', ') })}
            </p>
          ))}
          {result.defaultStatuses && (
            <p className="text-xs text-muted-foreground">
              {t('coverage.default_statuses', { statuses: result.defaultStatuses.join(', ') })}
            </p>
          )}
          {!preview && result.rows.length > 0 && (
            <PreviewGrid
              headers={fields.map((f) => t(`coverage.roles.${f}`))}
              rows={result.rows.slice(0, 10).map((r) => fields.map((f) => r[f]))}
            />
          )}
        </div>
      )}
    </div>
  )
}
