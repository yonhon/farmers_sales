import type {
  ShipmentCorrectionDiffResult,
  ShipmentCorrectionLine,
} from './shipmentReviewClient'

// Display helpers for the "前版との差分" panel of a correction batch
// (docs/decisions/008-shipment-report-version-supersession.md, section 5).

const fieldLabels: Record<string, string> = {
  canonical_product_name: '品目名',
  raw_product_name: '品目名（原記載）',
  raw_content: '内容量（原記載）',
  content_value: '内容量',
  content_value_min: '内容量下限',
  content_value_max: '内容量上限',
  weight_calculation_content_value: '重量計算用の内容量',
  content_unit_code: '単位',
  package_unit_code: '包装単位',
  unit_price_yen: '単価',
  shipment_package_quantity: '数量',
  source_page: 'ページ',
  source_row: '行',
  review_required: '要確認',
  notes: '注記',
  size_label: 'サイズ',
}

const unitLabels: Record<string, string> = {
  piece: '個',
  stem: '本',
  bag: '袋',
  pack: 'パック',
  bunch: '束',
  g: 'g',
  kg: 'kg',
}

export function correctionFieldLabel(key: string) {
  return fieldLabels[key] ?? key
}

export function correctionUnitLabel(code: string | null | undefined) {
  if (!code) return ''
  return unitLabels[code] ?? code
}

function numberText(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : String(value)
}

export function formatCorrectionValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '空欄'
  if (key === 'content_unit_code' || key === 'package_unit_code') return correctionUnitLabel(String(value))
  if (key === 'unit_price_yen') return `${numberText(value)}円`
  if (key === 'review_required') return value ? 'あり' : 'なし'
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value))) return numberText(value)
  return String(value)
}

// One line as it appears on the ledger: "ゴーヤー 1本 @108円 ×1".
export function formatCorrectionLine(line: ShipmentCorrectionLine) {
  const content = line.content_value === null || line.content_value === undefined
    ? ''
    : `${numberText(line.content_value)}${correctionUnitLabel(line.content_unit_code)}`
  const price = line.unit_price_yen === null || line.unit_price_yen === undefined
    ? '単価なし'
    : `@${numberText(line.unit_price_yen)}円`
  return [line.canonical_product_name ?? '品目名なし', content, price, `×${numberText(line.shipment_package_quantity)}`]
    .filter(Boolean)
    .join(' ')
}

export function formatCorrectionSource(line: Pick<ShipmentCorrectionLine, 'source_page' | 'source_row'>) {
  if (!line.source_page) return '帳票位置なし'
  return `${line.source_page} ${line.source_row ?? '?'}行目`
}

export type CorrectionDiffState = {
  approvalCurrent: boolean
  canApprove: boolean
  blockers: string[]
}

// Mirrors public.approve_shipment_correction_diff and the correction branch of
// public.finalize_shipment_review_batch: the diff can be approved only when every row is decided and
// every target day still has the replaced version and at least one line; finalize additionally needs
// the latest approval to be for exactly the current diff.
export function correctionDiffState(result: ShipmentCorrectionDiffResult | null): CorrectionDiffState {
  if (!result) return { approvalCurrent: false, canApprove: false, blockers: ['差分を読み込めていません。'] }
  const blockers: string[] = []
  const { diff } = result
  if (diff.undecided_row_count > 0) {
    blockers.push(`未判断の行が${diff.undecided_row_count}行あります。全行を承認または登録取下にしてください。`)
  }
  if (diff.target_days_without_expected_version > 0) {
    blockers.push('対象日の現在の版が、この訂正で置き換える版ではなくなっています。')
  }
  if (diff.target_days_without_lines > 0) {
    blockers.push('明細が1行も残らない出荷日があります。日ごとの削除には対応していません。')
  }
  return {
    approvalCurrent: Boolean(result.latest_approval?.is_current) && blockers.length === 0,
    canApprove: blockers.length === 0,
    blockers,
  }
}
