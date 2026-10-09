import { describe, expect, it } from 'vitest'
import type { ShipmentReviewBatchVerification } from './shipmentReviewClient'
import {
  SHIPMENT_REVIEW_VERIFICATION_COLUMNS,
  serializeShipmentReviewVerificationCsv,
  shipmentReviewVerificationFilename,
  summarizeShipmentReviewVerification,
} from './shipmentReviewVerification'

// The 2026-09 batch as public.get_shipment_review_batch_verification reports it after finalize.
const postflight: ShipmentReviewBatchVerification = {
  verification_phase: 'postflight',
  import_batch_id: 'cee0a1a8-20ec-429e-9578-78e2b2feb53f',
  bundle_sha256: '4eaf7e8900e5ee5e9c8436756f0100f379e89ddf4e28dada08a6c5fc954559ac',
  source_month: '2026-09-01',
  report_version: 1,
  finalized_at: '2026-10-09T13:24:51.796681+00:00',
  abandoned_at: null,
  import_status: 'imported',
  total_rows: 150,
  approved_rows: 150,
  no_shipment_rows: 0,
  unfinished_rows: 0,
  invalid_accepted_field_count: 0,
  blocking_issue_count: 0,
  expected_report_count: 21,
  linked_report_count: 21,
  linked_line_count: 150,
  approved_unlinked_rows: 0,
  no_shipment_linked_rows: 0,
  expected_package_quantity: 1797,
  imported_package_quantity: 1797,
  imported_amount_yen: 373154,
  recorded_report_count: 21,
  recorded_line_count: 150,
  completion_audit_event_count: 1,
  current_allocation_rows: 1581,
  current_unmatched_sales_quantity: 6127,
  finalization_result: { duplicate: false, shipment_lines: 150, shipment_reports: 21 },
  month_active_report_count: 21,
  month_active_line_count: 150,
  month_other_open_batch_count: 0,
  ready_to_finalize: false,
  postflight_pass: true,
}

const preflight: ShipmentReviewBatchVerification = {
  ...postflight,
  verification_phase: 'preflight',
  finalized_at: null,
  import_status: null,
  linked_report_count: 0,
  linked_line_count: 0,
  approved_unlinked_rows: 150,
  imported_package_quantity: 0,
  imported_amount_yen: 0,
  recorded_report_count: null,
  recorded_line_count: null,
  completion_audit_event_count: 0,
  finalization_result: null,
  month_active_report_count: 0,
  month_active_line_count: 0,
  ready_to_finalize: true,
  postflight_pass: false,
}

describe('shipment review verification', () => {
  it('writes one CSV record with the columns of the SQL Editor verification', () => {
    const csv = serializeShipmentReviewVerificationCsv(postflight, new Date('2026-10-09T14:00:00Z'))
    const [header, record, rest] = csv.replace('﻿', '').split('\r\n')

    expect(csv.startsWith('﻿')).toBe(true)
    expect(rest).toBe('')
    expect(header.split(',')).toEqual(['exported_at', ...SHIPMENT_REVIEW_VERIFICATION_COLUMNS])
    expect(record.startsWith('2026-10-09T14:00:00.000Z,postflight,cee0a1a8-20ec-429e-9578-78e2b2feb53f,')).toBe(true)
    // The JSON column is quoted, and a null column is empty.
    expect(record).toContain('"{""duplicate"":false,""shipment_lines"":150,""shipment_reports"":21}"')
    expect(record).toContain(',2026-10-09T13:24:51.796681+00:00,,imported,')
    expect(record.endsWith(',21,150,0,false,true')).toBe(true)
  })

  it('names the file by month and phase', () => {
    expect(shipmentReviewVerificationFilename(postflight)).toBe('shipment_review_verification_2026-09_postflight.csv')
    expect(shipmentReviewVerificationFilename(preflight)).toBe('shipment_review_verification_2026-09_preflight.csv')
    expect(shipmentReviewVerificationFilename({ ...postflight, verification_phase: 'target_not_found', source_month: null }))
      .toBe('shipment_review_verification_unknown_target_not_found.csv')
  })

  it('reports a passed postflight with the production totals', () => {
    expect(summarizeShipmentReviewVerification(postflight)).toEqual({
      pass: true,
      message: '反映後の検証：合格（出荷報告21件・明細150行・数量1797・金額373,154円）。',
    })
  })

  it('reports a failed postflight without claiming a cause', () => {
    const summary = summarizeShipmentReviewVerification({ ...postflight, linked_line_count: 149, postflight_pass: false })
    expect(summary.pass).toBe(false)
    expect(summary.message).toContain('不一致があります')
  })

  it('reports whether a batch can be finalized and why not', () => {
    expect(summarizeShipmentReviewVerification(preflight)).toEqual({
      pass: true,
      message: '反映前の検証：反映できます（承認150行・登録取下0行）。',
    })
    expect(summarizeShipmentReviewVerification({
      ...preflight,
      approved_rows: 140,
      unfinished_rows: 10,
      blocking_issue_count: 3,
      ready_to_finalize: false,
    })).toEqual({
      pass: false,
      message: '反映前の検証：まだ反映できません（未完了10行、未解決の警告3件）。',
    })
  })

  it('warns about another open batch for the same month', () => {
    const summary = summarizeShipmentReviewVerification({ ...postflight, month_other_open_batch_count: 1 })
    expect(summary.pass).toBe(true)
    expect(summary.message).toContain('同じ月に未完了のバッチがほかに1件あります')
  })

  it('reports a missing batch', () => {
    expect(summarizeShipmentReviewVerification({ ...postflight, verification_phase: 'target_not_found' }))
      .toEqual({ pass: false, message: '検証対象のバッチが見つかりません。' })
  })
})
