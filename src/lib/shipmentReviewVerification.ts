import type { ShipmentReviewBatchVerification } from './shipmentReviewClient'

// Column order of the verification CSV. It follows supabase/verify_shipment_review_production_batch.sql
// so a downloaded file reads like the SQL Editor result it replaces.
export const SHIPMENT_REVIEW_VERIFICATION_COLUMNS = [
  'verification_phase',
  'import_batch_id',
  'bundle_sha256',
  'source_month',
  'report_version',
  'finalized_at',
  'abandoned_at',
  'import_status',
  'total_rows',
  'approved_rows',
  'no_shipment_rows',
  'unfinished_rows',
  'invalid_accepted_field_count',
  'blocking_issue_count',
  'expected_report_count',
  'linked_report_count',
  'linked_line_count',
  'approved_unlinked_rows',
  'no_shipment_linked_rows',
  'expected_package_quantity',
  'imported_package_quantity',
  'imported_amount_yen',
  'recorded_report_count',
  'recorded_line_count',
  'completion_audit_event_count',
  'current_allocation_rows',
  'current_unmatched_sales_quantity',
  'finalization_result',
  'month_active_report_count',
  'month_active_line_count',
  'month_other_open_batch_count',
  'ready_to_finalize',
  'postflight_pass',
] as const satisfies ReadonlyArray<keyof ShipmentReviewBatchVerification>

function csvCell(value: unknown) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeShipmentReviewVerificationCsv(
  verification: ShipmentReviewBatchVerification,
  exportedAt = new Date(),
) {
  const header = ['exported_at', ...SHIPMENT_REVIEW_VERIFICATION_COLUMNS]
  const record = [
    exportedAt.toISOString(),
    ...SHIPMENT_REVIEW_VERIFICATION_COLUMNS.map((column) => verification[column]),
  ]
  return `﻿${header.join(',')}\r\n${record.map(csvCell).join(',')}\r\n`
}

export function shipmentReviewVerificationFilename(verification: ShipmentReviewBatchVerification) {
  const month = (verification.source_month ?? 'unknown').slice(0, 7)
  return `shipment_review_verification_${month}_${verification.verification_phase}.csv`
}

export type ShipmentReviewVerificationSummary = {
  pass: boolean
  message: string
}

// The verdict a person needs from the verification, with the reason when it fails.
export function summarizeShipmentReviewVerification(
  verification: ShipmentReviewBatchVerification,
): ShipmentReviewVerificationSummary {
  if (verification.verification_phase === 'target_not_found') {
    return { pass: false, message: '検証対象のバッチが見つかりません。' }
  }
  const otherOpen = verification.month_other_open_batch_count
  const otherOpenNote = otherOpen > 0
    ? ` 同じ月に未完了のバッチがほかに${otherOpen}件あります。反映しないバッチは閉じてください。`
    : ''
  if (verification.verification_phase === 'preflight') {
    if (verification.ready_to_finalize) {
      return {
        pass: true,
        message: `反映前の検証：反映できます（承認${verification.approved_rows}行・登録取下${verification.no_shipment_rows}行）。${otherOpenNote}`,
      }
    }
    const reasons = [
      verification.unfinished_rows > 0 ? `未完了${verification.unfinished_rows}行` : '',
      verification.blocking_issue_count > 0 ? `未解決の警告${verification.blocking_issue_count}件` : '',
      verification.invalid_accepted_field_count > 0 ? `確定値のない項目${verification.invalid_accepted_field_count}件` : '',
      verification.approved_rows === 0 ? '承認済みの行がありません' : '',
    ].filter(Boolean)
    return {
      pass: false,
      message: `反映前の検証：まだ反映できません（${reasons.join('、') || '条件を満たしていません'}）。${otherOpenNote}`,
    }
  }
  if (verification.postflight_pass) {
    return {
      pass: true,
      message: `反映後の検証：合格（出荷報告${verification.linked_report_count}件・明細${verification.linked_line_count}行・数量${Number(verification.imported_package_quantity)}・金額${Number(verification.imported_amount_yen).toLocaleString('ja-JP')}円）。${otherOpenNote}`,
    }
  }
  return {
    pass: false,
    message: `反映後の検証：不一致があります。検証結果CSVを保存して内容を確認してください。${otherOpenNote}`,
  }
}
