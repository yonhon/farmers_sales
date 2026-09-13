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
  row_status: ShipmentReviewRowStatus
  shipment_date: string
  market_code: string
  destination: string | null
  raw_notes: string | null
  review_note: string | null
  comment: string | null
  linked_shipment_line_id: string | null
  observations: ShipmentReviewObservation[]
  issues: ShipmentReviewIssue[]
  actions: ShipmentReviewActionRecord[]
}

export type ShipmentReviewBatchSummary = {
  import_batch_id: string
  source_month: string
  report_version: number
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
  validator_version: string
  lookahead_days: number
  reference_snapshot_id: string | null
  finalized_at: string | null
  finalization_result: Record<string, unknown> | null
  rows: ShipmentReviewDbRow[]
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
  observation_id?: string
  issue_id?: string
  field_name?: ShipmentReviewField
  raw_value?: string | null
  normalized_value?: unknown
  confidence?: string
  evidence?: Record<string, unknown>
  notes?: string
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
  if (message.includes('SHIPMENT_REVIEW_CONFLICT')) {
    return new ShipmentReviewApiError('別の操作で状態が更新されました。最新状態を再読み込みしてください。', 'conflict', true)
  }
  if (message.includes('SHIPMENT_REVIEW_NOT_READY')) {
    return new ShipmentReviewApiError('未確認・保留・未処理の警告が残っているため反映できません。', 'not_ready', false)
  }
  if (message.includes('SHIPMENT_REVIEW_REFERENCE_NOT_FOUND')) {
    return new ShipmentReviewApiError('参照先の品目・単位・市場が見つかりません。', 'reference_missing', false)
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

    async importBundle(bundle: unknown) {
      requireObject(bundle, 'レビューbundle')
      return requireObject<{ import_batch_id: string; created: boolean }>(
        await rpc('import_shipment_review_bundle', { p_bundle: bundle }),
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

    async finalize(importBatchId: string) {
      return requireObject<Record<string, unknown>>(
        await rpc('finalize_shipment_review_batch', { p_import_batch_id: importBatchId }),
        '本番反映',
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
