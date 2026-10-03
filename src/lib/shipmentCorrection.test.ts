import { describe, expect, it } from 'vitest'

import {
  correctionDiffState,
  correctionFieldLabel,
  formatCorrectionLine,
  formatCorrectionSource,
  formatCorrectionValue,
} from './shipmentCorrection'
import type { ShipmentCorrectionDiffResult } from './shipmentReviewClient'

function diffResult(overrides: Partial<ShipmentCorrectionDiffResult['diff']> = {}, isCurrent: boolean | null = null) {
  return {
    diff: {
      import_batch_id: 'batch-1',
      report_version: 2,
      undecided_row_count: 0,
      target_days_without_expected_version: 0,
      target_days_without_lines: 0,
      days: [],
      excluded_target_rows: [],
      ...overrides,
    },
    diff_sha256: 'a'.repeat(64),
    latest_approval: isCurrent === null ? null : {
      diff_sha256: isCurrent ? 'a'.repeat(64) : 'b'.repeat(64),
      approved_by: 'user-1',
      approved_at: '2026-10-03T00:00:00Z',
      notes: null,
      is_current: isCurrent,
    },
  } satisfies ShipmentCorrectionDiffResult
}

describe('shipment correction diff helpers', () => {
  it('formats a line the way the ledger reads', () => {
    expect(formatCorrectionLine({
      canonical_product_name: 'ゴーヤー',
      content_value: 1,
      content_unit_code: 'stem',
      unit_price_yen: 108,
      shipment_package_quantity: 1,
      source_page: 'p02',
      source_row: 38,
    })).toBe('ゴーヤー 1本 @108円 ×1')
    expect(formatCorrectionLine({
      canonical_product_name: 'オクラ',
      content_value: 350,
      content_unit_code: 'g',
      unit_price_yen: null,
      shipment_package_quantity: 2,
      source_page: null,
      source_row: null,
    })).toBe('オクラ 350g 単価なし ×2')
  })

  it('labels fields and values in Japanese', () => {
    expect(correctionFieldLabel('shipment_package_quantity')).toBe('数量')
    expect(correctionFieldLabel('unknown_key')).toBe('unknown_key')
    expect(formatCorrectionValue('unit_price_yen', 216)).toBe('216円')
    expect(formatCorrectionValue('content_unit_code', 'piece')).toBe('個')
    expect(formatCorrectionValue('content_value', '350.000')).toBe('350')
    expect(formatCorrectionValue('notes', null)).toBe('空欄')
    expect(formatCorrectionSource({ source_page: 'scan-02.jpg', source_row: 4 })).toBe('scan-02.jpg 4行目')
    expect(formatCorrectionSource({ source_page: null, source_row: null })).toBe('帳票位置なし')
  })

  it('allows approval only when every row is decided and every day keeps a line', () => {
    expect(correctionDiffState(null)).toMatchObject({ canApprove: false, approvalCurrent: false })
    expect(correctionDiffState(diffResult())).toMatchObject({ canApprove: true, approvalCurrent: false })
    expect(correctionDiffState(diffResult({ undecided_row_count: 2 })).canApprove).toBe(false)
    expect(correctionDiffState(diffResult({ target_days_without_lines: 1 })).canApprove).toBe(false)
    expect(correctionDiffState(diffResult({ target_days_without_expected_version: 1 })).canApprove).toBe(false)
  })

  it('treats only an approval of the current diff as ready to finalize', () => {
    expect(correctionDiffState(diffResult({}, true)).approvalCurrent).toBe(true)
    expect(correctionDiffState(diffResult({}, false)).approvalCurrent).toBe(false)
    expect(correctionDiffState(diffResult({ undecided_row_count: 1 }, true)).approvalCurrent).toBe(false)
  })
})
