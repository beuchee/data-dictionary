import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COLUMN_ROLES, DELIMITERS, ENCODINGS, type ColumnRole, type ParseOptions } from '@/lib/mapping-import/types'
import type { ImportModel } from './import-model'

interface ImportOptionsProps {
  options: ParseOptions
  model: ImportModel
  onChange: (next: ParseOptions) => void
}

const NONE = '__none__'
const DELIMITER_KEYS: Record<string, string> = { auto: 'auto', ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }

function SmallSelect({ label, value, onChange, items }: {
  label: string
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value} className="text-xs">
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Delimiter, encoding, sheet, header, skipped lines and column roles, as the format needs them. */
export function ImportOptions({ options, model, onChange }: ImportOptionsProps) {
  const { t } = useTranslation()
  const set = (patch: Partial<ParseOptions>) => onChange({ ...options, ...patch })
  const isList = options.format === 'concept_ids'
  const tableLike = options.format === 'generic' || isList
  const textOptions = model.isText && options.format !== 'linkr'
  const sheets = model.preview?.sheetNames ?? null
  const headers = model.preview?.headers ?? []
  const roles: readonly ColumnRole[] = isList ? ['targetConceptId'] : COLUMN_ROLES

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {textOptions && (
          <>
            <SmallSelect
              label={t('coverage.delimiter')}
              value={options.delimiter ?? 'auto'}
              onChange={(v) => set({ delimiter: v as ParseOptions['delimiter'] })}
              items={DELIMITERS.map((d) => ({ value: d, label: t(`coverage.delimiters.${DELIMITER_KEYS[d]}`) }))}
            />
            <SmallSelect
              label={t('coverage.encoding')}
              value={options.encoding ?? 'auto'}
              onChange={(v) => set({ encoding: v as ParseOptions['encoding'] })}
              items={ENCODINGS.map((e) => ({ value: e, label: e === 'auto' ? t('coverage.encoding_auto') : e.toUpperCase() }))}
            />
          </>
        )}
        {model.isXlsx && sheets && sheets.length > 1 && (
          <SmallSelect
            label={t('coverage.sheet')}
            value={options.sheet ?? sheets[0]}
            onChange={(v) => set({ sheet: v })}
            items={sheets.map((s) => ({ value: s, label: s }))}
          />
        )}
        {tableLike && (
          <>
            <SmallSelect
              label={t('coverage.header')}
              value={options.hasHeader === false ? 'no' : options.hasHeader === true || !isList ? 'yes' : 'auto'}
              onChange={(v) => set({ hasHeader: v === 'auto' ? undefined : v === 'yes', columns: undefined })}
              items={[
                ...(isList ? [{ value: 'auto', label: t('coverage.header_auto') }] : []),
                { value: 'yes', label: t('coverage.header_yes') },
                { value: 'no', label: t('coverage.header_no') },
              ]}
            />
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground" htmlFor="mapping-skip-rows">
                {t('coverage.skip_rows')}
              </Label>
              <Input
                id="mapping-skip-rows"
                type="number"
                min={0}
                max={1000}
                className="h-7 text-xs"
                value={options.skipRows ?? 0}
                onChange={(e) => set({ skipRows: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
              />
            </div>
          </>
        )}
      </div>

      {tableLike && headers.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{t('coverage.column_roles')}</Label>
          <p className="text-[10px] text-muted-foreground">{t('coverage.column_roles_hint')}</p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {roles.map((role) => (
              <div key={role} className="flex items-center gap-2">
                <Label className="w-32 shrink-0 text-[10px] text-muted-foreground">
                  {t(`coverage.roles.${role}`)}
                  {role === 'targetConceptId' && !isList && <span className="text-destructive"> *</span>}
                </Label>
                <Select
                  value={options.columns?.[role] ?? NONE}
                  onValueChange={(v) => set({ columns: { ...options.columns, [role]: v === NONE ? undefined : v } })}
                >
                  <SelectTrigger size="sm" className="h-7 flex-1 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs text-muted-foreground">
                      {isList ? t('coverage.first_column') : t('coverage.no_column')}
                    </SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h} className="text-xs">
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
