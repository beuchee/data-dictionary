// The OMOP vocabulary tables and their layout, ported from v1 (legacy/dev-tools.js ERD).

export type ErdTone = 'reference' | 'concept' | 'link'

export interface ErdColumn {
  name: string
  pk?: boolean
  /** The table this column references. */
  fk?: string
}

export interface ErdTable {
  name: string
  /** reference tables (top), concept (middle), concepts' links (bottom). */
  tone: ErdTone
  row: number
  col: number
  columns: ErdColumn[]
}

export const ERD_TABLES: readonly ErdTable[] = [
  { name: 'vocabulary', tone: 'reference', row: 0, col: 0, columns: [{ name: 'vocabulary_id', pk: true }, { name: 'vocabulary_name' }, { name: 'vocabulary_version' }, { name: 'vocabulary_concept_id', fk: 'concept' }] },
  { name: 'domain', tone: 'reference', row: 0, col: 1, columns: [{ name: 'domain_id', pk: true }, { name: 'domain_name' }, { name: 'domain_concept_id', fk: 'concept' }] },
  { name: 'concept_class', tone: 'reference', row: 0, col: 2, columns: [{ name: 'concept_class_id', pk: true }, { name: 'concept_class_name' }, { name: 'concept_class_concept_id', fk: 'concept' }] },
  { name: 'relationship', tone: 'reference', row: 0, col: 3, columns: [{ name: 'relationship_id', pk: true }, { name: 'relationship_name' }, { name: 'defines_ancestry' }, { name: 'relationship_concept_id', fk: 'concept' }] },
  {
    name: 'concept',
    tone: 'concept',
    row: 1,
    col: 1.5,
    columns: [
      { name: 'concept_id', pk: true },
      { name: 'concept_name' },
      { name: 'domain_id', fk: 'domain' },
      { name: 'vocabulary_id', fk: 'vocabulary' },
      { name: 'concept_class_id', fk: 'concept_class' },
      { name: 'standard_concept' },
      { name: 'concept_code' },
      { name: 'valid_start_date' },
      { name: 'valid_end_date' },
      { name: 'invalid_reason' },
    ],
  },
  { name: 'concept_ancestor', tone: 'link', row: 2, col: 0, columns: [{ name: 'ancestor_concept_id', fk: 'concept' }, { name: 'descendant_concept_id', fk: 'concept' }, { name: 'min_levels_of_separation' }, { name: 'max_levels_of_separation' }] },
  { name: 'concept_relationship', tone: 'link', row: 2, col: 1, columns: [{ name: 'concept_id_1', fk: 'concept' }, { name: 'concept_id_2', fk: 'concept' }, { name: 'relationship_id', fk: 'relationship' }, { name: 'valid_start_date' }, { name: 'valid_end_date' }, { name: 'invalid_reason' }] },
  { name: 'concept_synonym', tone: 'link', row: 2, col: 2, columns: [{ name: 'concept_id', fk: 'concept' }, { name: 'concept_synonym_name' }, { name: 'language_concept_id', fk: 'concept' }] },
  { name: 'drug_strength', tone: 'link', row: 2, col: 3, columns: [{ name: 'drug_concept_id', fk: 'concept' }, { name: 'ingredient_concept_id', fk: 'concept' }, { name: 'amount_value' }, { name: 'amount_unit_concept_id', fk: 'concept' }, { name: 'numerator_value' }, { name: 'denominator_value' }] },
]

export const CARD_W = 220
export const HEADER_H = 34
export const ROW_H = 20
const GAP_X = 36
const ROW_SPACING = 260
const PAD = 24

export interface ErdBox {
  table: ErdTable
  x: number
  y: number
  w: number
  h: number
}

export interface ErdEdge {
  key: string
  from: string
  to: string
  tone: ErdTone
  /** SVG path (a cubic curve). */
  d: string
}

export interface ErdLayout {
  boxes: ErdBox[]
  edges: ErdEdge[]
  width: number
  height: number
}

/** Card positions on a 4-column grid (concept centred) and one curve per foreign key, as v1 drew them. */
export function erdLayout(tables: readonly ErdTable[] = ERD_TABLES): ErdLayout {
  const gridW = 4 * CARD_W + 3 * GAP_X
  const boxes = tables.map((table): ErdBox => {
    const h = HEADER_H + table.columns.length * ROW_H + 8
    const x = table.name === 'concept' ? PAD + (gridW - CARD_W) / 2 : PAD + table.col * (CARD_W + GAP_X)
    return { table, x, y: PAD + table.row * ROW_SPACING, w: CARD_W, h }
  })
  const byName = new Map(boxes.map((b) => [b.table.name, b]))
  const edges: ErdEdge[] = []
  for (const src of boxes) {
    src.table.columns.forEach((col, i) => {
      const tgt = col.fk ? byName.get(col.fk) : undefined
      if (!tgt || tgt === src) return
      const rowY = src.y + HEADER_H + i * ROW_H + ROW_H / 2
      let x1: number, y1: number, x2: number, y2: number
      if (src.y > tgt.y + tgt.h) {
        ;[x1, y1, x2, y2] = [src.x + src.w / 2, src.y, tgt.x + tgt.w / 2, tgt.y + tgt.h]
      } else if (src.y + src.h < tgt.y) {
        ;[x1, y1, x2, y2] = [src.x + src.w / 2, src.y + src.h, tgt.x + tgt.w / 2, tgt.y]
      } else if (src.x > tgt.x) {
        ;[x1, y1, x2, y2] = [src.x, rowY, tgt.x + tgt.w, tgt.y + tgt.h / 2]
      } else {
        ;[x1, y1, x2, y2] = [src.x + src.w, rowY, tgt.x, tgt.y + tgt.h / 2]
      }
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      const d =
        Math.abs(y1 - y2) > Math.abs(x1 - x2)
          ? `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
          : `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`
      edges.push({ key: `${src.table.name}.${col.name}`, from: src.table.name, to: tgt.table.name, tone: src.table.tone, d })
    })
  }
  const width = Math.max(...boxes.map((b) => b.x + b.w)) + PAD
  const height = Math.max(...boxes.map((b) => b.y + b.h)) + PAD
  return { boxes, edges, width, height }
}
