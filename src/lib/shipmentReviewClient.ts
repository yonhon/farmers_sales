import type { MarkdownSalesReference } from './shipmentMarkdown'
import { supabase } from './supabase'

export type ShipmentReviewRowStatus =
  | 'unreviewed'
  | 'in_review'
  | 'approved'
  | 'deferred'
  | 'no_shipment'
  | 'rejected'

export type ShipmentReviewField =
  | 'product'
  | 'content_value'
  | 'content_unit'
  | 'unit_price_yen'
  | 'shipment_package_quantity'
  // ADR007: optional sticker price; unit_price_yen then holds the list price.
  | 'markdown_unit_price_yen'

export type ShipmentReviewObservation = {
  shipment_field_observation_id: string
  field_name: ShipmentReviewField
  raw_value: string | null
  normalized_value: unknown
  value_source: string
  confidence: string
  review_status: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  evidence: Record<string, unknown>
  recorded_at: string
}

export function isShipmentReviewCandidate(observation: ShipmentReviewObservation) {
  return observation.review_status === 'proposed'
    && typeof observation.evidence.candidate_group_key === 'string'
}

export function primaryShipmentReviewObservation(
  row: ShipmentReviewDbRow,
  field: ShipmentReviewField,
) {
  const observations = row.observations.filter((item) => item.field_name === field)
  return observations.find((item) => item.review_status === 'accepted')
    ?? observations.find((item) => (
      item.review_status === 'proposed' && !isShipmentReviewCandidate(item)
    ))
    ?? null
}

// The value the pre-input (LLM transcription) originally proposed for a field. Corrections supersede
// it in the database but never delete it, so it stays available for reference after the box is edited.
// Candidate suggestions and human corrections are not part of the original reading.
export function initialShipmentReviewObservation(
  row: ShipmentReviewDbRow,
  field: ShipmentReviewField,
) {
  return row.observations
    .filter((item) => (
      item.field_name === field
      && item.value_source !== 'human_corrected'
      && item.value_source !== 'missing_accepted'
      && typeof item.evidence?.candidate_group_key !== 'string'
    ))
    .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))[0]
    ?? null
}

export function actionableShipmentReviewCandidates(row: ShipmentReviewDbRow) {
  const seen = new Set<string>()
  return row.observations.filter((candidate) => {
    if (!isShipmentReviewCandidate(candidate)) return false
    const accepted = row.observations.find((observation) => (
      observation.field_name === candidate.field_name
      && observation.review_status === 'accepted'
    ))
    const transcribed = row.observations.find((observation) => (
      observation.field_name === candidate.field_name
      && observation.review_status === 'proposed'
      && !isShipmentReviewCandidate(observation)
    ))
    const current = accepted ?? transcribed
    if (current && String(current.normalized_value ?? '') === String(candidate.normalized_value ?? '')) {
      return false
    }
    const candidateKey = `${candidate.field_name}:${JSON.stringify(candidate.normalized_value)}`
    if (seen.has(candidateKey)) return false
    seen.add(candidateKey)
    return true
  })
}

export type TaxAdjustedSalesMatch = {
  report_date: string
  sales_unit_price_yen: number
  sold_quantity: number
}

export type TaxAdjustedSalesReference = {
  shipment_unit_price_yen: number | null
  matches: TaxAdjustedSalesMatch[]
}

export type ShipmentReviewIssue = {
  shipment_review_issue_id: string
  field_name: ShipmentReviewField | null
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  evidence: Record<string, unknown>
  issue_status: 'open' | 'accepted' | 'resolved'
  resolved_at: string | null
  created_at: string
}

export type ShipmentReviewActionRecord = {
  shipment_review_action_id: string
  action_type: string
  field_name: ShipmentReviewField | null
  observation_id?: string | null
  shipment_review_issue_id?: string | null
  from_status: ShipmentReviewRowStatus | null
  to_status: ShipmentReviewRowStatus | null
  evidence?: Record<string, unknown>
  notes: string | null
  acted_by?: string | null
  request_id?: string | null
  request_payload_hash?: string | null
  acted_at: string
}

export type ShipmentReviewDbRow = {
  shipment_review_row_id: string
  import_batch_id: string
  source_page: string
  source_row: number
  // ADR007: 0 for the ledger row as transcribed, 1, 2, ... for parts split from it.
  source_part?: number
  split_from_review_row_id?: string | null
  split_total?: number | null
  row_status: ShipmentReviewRowStatus
  shipment_date: string
  market_code: string
  destination: string | null
  raw_notes: string | null
  review_note: string | null
  comment: string | null
  linked_shipment_line_id: string | null
  // Correction batches (ADR008): the production line a carried-over row was copied from, or the
  // earlier withdrawn/deferred review row a target row re-reviews.
  carried_from_shipment_line_id?: string | null
  carried_from_review_row_id?: string | null
  observations: ShipmentReviewObservation[]
  issues: ShipmentReviewIssue[]
  actions: ShipmentReviewActionRecord[]
}

export type ShipmentReviewBatchKind = 'initial' | 'correction'

export type ShipmentCorrectionTarget = {
  market_code: string
  shipment_date: string
}

export type ShipmentReviewBatchSummary = {
  import_batch_id: string
  source_month: string
  report_version: number
  batch_kind?: ShipmentReviewBatchKind
  correction_targets?: ShipmentCorrectionTarget[] | null
  correction_reason?: string | null
  source_filename: string
  row_count: number
  pending_count: number
  deferred_count: number
  finalized_at: string | null
  created_at: string
}

export type ShipmentReviewBatch = {
  import_batch_id: string
  bundle_sha256?: string
  bundle_schema_version: number
  source_month: string
  report_version: number
  batch_kind?: ShipmentReviewBatchKind
  correction_targets?: ShipmentCorrectionTarget[] | null
  correction_reason?: string | null
  validator_version: string
  lookahead_days: number
  reference_snapshot_id: string | null
  finalized_at: string | null
  finalization_result: Record<string, unknown> | null
  rows: ShipmentReviewDbRow[]
}

// A carried-over row is a copy of a line already in production. Changing it (returning it to review,
// re-approving it, or withdrawing it) requires a reason (public.apply_shipment_review_action, ADR008).
export function isCarriedOverShipmentReviewRow(
  row: Pick<ShipmentReviewDbRow, 'carried_from_shipment_line_id'>,
) {
  return Boolean(row.carried_from_shipment_line_id)
}

export type ShipmentCorrectionLine = {
  canonical_product_name: string | null
  raw_product_name?: string | null
  raw_content?: string | null
  content_value: number | null
  content_value_min?: number | null
  content_value_max?: number | null
  weight_calculation_content_value?: number | null
  content_unit_code: string | null
  package_unit_code?: string | null
  unit_price_yen: number | null
  shipment_package_quantity: number
  source_page: string | null
  source_row: number | null
  review_required?: boolean | null
  notes?: string | null
  size_label?: string | null
}

export type ShipmentCorrectionTotals = {
  line_count: number
  package_quantity: number
  amount_yen: number
}

export type ShipmentCorrectionDay = {
  market_code: string
  shipment_date: string
  active_report_version: number | null
  before: ShipmentCorrectionTotals
  after: ShipmentCorrectionTotals
  added: Array<ShipmentCorrectionLine & { shipment_review_row_id: string }>
  removed: Array<ShipmentCorrectionLine & {
    shipment_line_id: string
    shipment_review_row_id: string | null
    row_status: ShipmentReviewRowStatus | null
    reason: string | null
  }>
  changed: Array<{
    shipment_line_id: string
    shipment_review_row_id: string
    changed_fields: string[] | null
    before: ShipmentCorrectionLine
    after: ShipmentCorrectionLine
  }>
  unchanged_count: number
}

export type ShipmentCorrectionDiff = {
  import_batch_id: string
  report_version: number
  undecided_row_count: number
  target_days_without_expected_version: number
  target_days_without_lines: number
  days: ShipmentCorrectionDay[]
  excluded_target_rows: Array<{
    shipment_review_row_id: string
    source_page: string
    source_row: number
    shipment_date: string
    row_status: ShipmentReviewRowStatus
    carried_from_review_row_id: string | null
    reason: string | null
  }>
}

export type ShipmentCorrectionDiffResult = {
  diff: ShipmentCorrectionDiff
  diff_sha256: string
  latest_approval: {
    diff_sha256: string
    approved_by: string
    approved_at: string
    notes: string | null
    is_current: boolean
  } | null
}

export function canFinalizeShipmentReview(
  rows: Array<Pick<ShipmentReviewDbRow, 'row_status'>>,
) {
  return rows.some((row) => row.row_status === 'approved')
    && rows.every((row) => ['approved', 'no_shipment'].includes(row.row_status))
}

export type ShipmentReviewAction = {
  request_id: string
  shipment_review_row_id: string
  expected_row_status: ShipmentReviewRowStatus
  action_type:
    | 'start_review'
    | 'accept_candidate'
    | 'reject_candidate'
    | 'correct_value'
    | 'accept_issue'
    | 'resolve_issue'
    | 'approve'
    | 'defer'
    | 'mark_no_shipment'
    | 'reject_row'
    | 'return_to_review'
    | 'comment'
    | 'split_row'
  observation_id?: string
  issue_id?: string
  field_name?: ShipmentReviewField
  raw_value?: string | null
  normalized_value?: unknown
  confidence?: string
  evidence?: Record<string, unknown>
  notes?: string
  // split_row: the number of units moved to the new part.
  quantity?: number
}

export type ShipmentReviewErrorKind =
  | 'permission'
  | 'feature_disabled'
  | 'conflict'
  | 'not_ready'
  | 'invalid'
  | 'reference_missing'
  | 'retryable'

type BackendError = { message?: string; code?: string; status?: number }
type BackendResult = PromiseLike<{ data: unknown; error: BackendError | null }>

export type ShipmentReviewBackend = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => BackendResult
      }
    }
  }
  rpc: (name: string, args?: Record<string, unknown>) => BackendResult
}

export class ShipmentReviewApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ShipmentReviewErrorKind,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ShipmentReviewApiError'
  }
}

function apiError(error: BackendError): ShipmentReviewApiError {
  const message = error.message || 'Supabaseとの通信に失敗しました。'
  if (message.includes('SHIPMENT_REVIEW_UNAUTHORIZED')) {
    return new ShipmentReviewApiError('出荷確認を操作する権限がありません。', 'permission', false)
  }
  if (message.includes('SHIPMENT_REVIEW_FEATURE_DISABLED')) {
    return new ShipmentReviewApiError('出荷入力機能は現在無効です。', 'feature_disabled', false)
  }
  if (message.includes('the diff changed after it was displayed')) {
    return new ShipmentReviewApiError(
      '表示した後に差分が変わりました。最新状態を再読み込みし、差分を確認し直してから承認してください。',
      'conflict',
      true,
    )
  }
  if (message.includes('another open correction batch already targets')) {
    return new ShipmentReviewApiError(
      '同じ出荷日を対象にした未完了の訂正バッチが既にあります。そのバッチを完了するか破棄してから登録してください。',
      'conflict',
      false,
    )
  }
  if (message.includes('must have active version')) {
    return new ShipmentReviewApiError(
      '訂正bundleの版が、対象日の現在の版の次の版になっていません。bundleを作り直してください。',
      'conflict',
      false,
    )
  }
  if (message.includes('SHIPMENT_REVIEW_CONFLICT')) {
    return new ShipmentReviewApiError('別の操作で状態が更新されました。最新状態を再読み込みしてください。', 'conflict', true)
  }
  if (message.includes('the current correction diff has not been approved')) {
    return new ShipmentReviewApiError(
      '前版との差分が未承認か、承認した後に内容が変わりました。「前版との差分」を確認して承認してから反映してください。',
      'not_ready',
      false,
    )
  }
  if (message.includes('every row must be approved or withdrawn before the diff is approved')) {
    return new ShipmentReviewApiError('全行を承認または登録取下にしてから差分を承認してください。', 'not_ready', false)
  }
  if (message.includes('a correction cannot remove every line of a day')) {
    return new ShipmentReviewApiError(
      'ある出荷日の明細をすべて取り下げる訂正には対応していません。少なくとも1行を承認してください。',
      'not_ready',
      false,
    )
  }
  if (message.includes('must add up to the quantity before the split')) {
    return new ShipmentReviewApiError(
      '分割した行の数量の合計が、分割前の数量と一致しません。各行の数量を見直してください（登録取下にした行も合計に含まれます）。',
      'not_ready',
      false,
    )
  }
  if (message.includes('an approved markdown row has no discount slot left')) {
    return new ShipmentReviewApiError(
      '値引枠を確保できない値引分の行が承認されています。その行を確認し直し、登録取下にしてください。',
      'not_ready',
      false,
    )
  }
  if (message.includes('SHIPMENT_REVIEW_NOT_READY')) {
    return new ShipmentReviewApiError(
      '未処理の警告・エラーが残っているため承認できません。下の「警告・確認事項」欄を開き、'
      + '内容を確認のうえ「確認して許容」または「修正済みとして解決」を押してから、再度承認してください。',
      'not_ready',
      false,
    )
  }
  if (message.includes('SHIPMENT_REVIEW_REFERENCE_NOT_FOUND')) {
    return new ShipmentReviewApiError('参照先の品目・単位・市場が見つかりません。', 'reference_missing', false)
  }
  if (message.includes('a reason is required to return a carried-over row to review')
    || message.includes('a reason is required to re-approve a carried-over row')) {
    return new ShipmentReviewApiError(
      '前版から引き継いだ行（本番の明細）を変更するには、判断理由を入力してください。',
      'invalid',
      false,
    )
  }
  if (message.includes('the split quantity must be a whole number')) {
    return new ShipmentReviewApiError(
      '分割する個数は、1以上で行の数量より少ない整数で入力してください。',
      'invalid',
      false,
    )
  }
  if (message.includes('SHIPMENT_REVIEW_INVALID_PAYLOAD')) {
    return new ShipmentReviewApiError('入力データの形式が正しくありません。', 'invalid', false)
  }
  const retryable = !error.status || error.status >= 500 || /fetch|network|timeout/i.test(message)
  return new ShipmentReviewApiError(message, retryable ? 'retryable' : 'invalid', retryable)
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShipmentReviewApiError(`${label}の応答形式が正しくありません。`, 'invalid', false)
  }
  return value as T
}

export function createShipmentReviewApi(client: ShipmentReviewBackend) {
  async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args)
    if (error) throw apiError(error)
    return data as T
  }

  return {
    async getFeatureEnabled(): Promise<boolean> {
      const { data, error } = await client
        .from('app_features')
        .select('is_enabled')
        .eq('feature_key', 'shipment_input')
        .maybeSingle()
      if (error) throw apiError(error)
      return requireObject<{ is_enabled?: unknown }>(data, 'feature flag').is_enabled === true
    },

    // A bundle with a "correction" object is a correction bundle (ADR008): it replaces the active
    // versions of its target days and is registered through its own RPC.
    async importBundle(bundle: unknown) {
      const value = requireObject<Record<string, unknown>>(bundle, 'レビューbundle')
      const isCorrection = Boolean(value.correction) && typeof value.correction === 'object'
      return requireObject<{ import_batch_id: string; created: boolean; batch_kind?: ShipmentReviewBatchKind }>(
        await rpc(
          isCorrection ? 'import_shipment_correction_bundle' : 'import_shipment_review_bundle',
          { p_bundle: bundle },
        ),
        'bundle登録',
      )
    },

    async listBatches(): Promise<ShipmentReviewBatchSummary[]> {
      const data = await rpc<unknown>('list_shipment_review_batches')
      if (!Array.isArray(data)) {
        throw new ShipmentReviewApiError('バッチ一覧の応答形式が正しくありません。', 'invalid', false)
      }
      return data as ShipmentReviewBatchSummary[]
    },

    async getBatch(importBatchId: string): Promise<ShipmentReviewBatch> {
      return requireObject<ShipmentReviewBatch>(
        await rpc('get_shipment_review_batch', { p_import_batch_id: importBatchId }),
        'バッチ詳細',
      )
    },

    async applyAction(action: ShipmentReviewAction) {
      return requireObject<{ row_status: ShipmentReviewRowStatus; duplicate: boolean }>(
        await rpc('apply_shipment_review_action', { p_action: action }),
        'レビュー操作',
      )
    },

    async getCorrectionDiff(importBatchId: string): Promise<ShipmentCorrectionDiffResult> {
      return requireObject<ShipmentCorrectionDiffResult>(
        await rpc('get_shipment_correction_diff', { p_import_batch_id: importBatchId }),
        '前版との差分',
      )
    },

    async approveCorrectionDiff(importBatchId: string, diffSha256: string, notes?: string) {
      return requireObject<{ diff_sha256: string }>(
        await rpc('approve_shipment_correction_diff', {
          p_import_batch_id: importBatchId,
          p_diff_sha256: diffSha256,
          p_notes: notes?.trim() || null,
        }),
        '差分の承認',
      )
    },

    // ADR007: discounted sales whose per-unit discounted price equals the row's sticker price.
    async markdownSalesReference(shipmentReviewRowId: string) {
      return requireObject<MarkdownSalesReference>(
        await rpc('shipment_review_markdown_sales_reference', {
          p_shipment_review_row_id: shipmentReviewRowId,
        }),
        '値引販売の実績',
      )
    },

    async finalize(importBatchId: string) {
      return requireObject<Record<string, unknown>>(
        await rpc('finalize_shipment_review_batch', { p_import_batch_id: importBatchId }),
        '本番反映',
      )
    },

    // Evidence for an open tax_adjusted_price_match_candidate issue: the actual sales-side price(s)
    // that only matched the row's accepted unit price through the tax-exclusive rounding.
    async taxAdjustedSalesReference(shipmentReviewRowId: string) {
      return requireObject<TaxAdjustedSalesReference>(
        await rpc('shipment_review_tax_adjusted_sales_reference', {
          p_shipment_review_row_id: shipmentReviewRowId,
        }),
        '税調整後の販売実績',
      )
    },
  }
}

export function getShipmentReviewApi() {
  if (!supabase) {
    throw new ShipmentReviewApiError('Supabaseが設定されていません。', 'retryable', false)
  }
  return createShipmentReviewApi(supabase as unknown as ShipmentReviewBackend)
}

export function createShipmentReviewRequestId() {
  return crypto.randomUUID()
}

export function shipmentReviewDecisionAdvances(
  actionType: 'approve' | 'defer' | 'mark_no_shipment' | 'reject_row',
) {
  return actionType === 'approve' || actionType === 'defer' || actionType === 'mark_no_shipment'
}
