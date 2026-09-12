import { describe, expect, it, vi } from 'vitest'

import {
  ShipmentReviewApiError,
  actionableShipmentReviewCandidates,
  canFinalizeShipmentReview,
  createShipmentReviewApi,
  primaryShipmentReviewObservation,
  shipmentReviewDecisionAdvances,
  type ShipmentReviewBackend,
  type ShipmentReviewDbRow,
} from './shipmentReviewClient'

function backend(options?: { feature?: unknown; featureError?: { message: string }; rpc?: unknown; rpcError?: { message: string } }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options && 'feature' in options ? options.feature : { is_enabled: true },
    error: options?.featureError ?? null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn().mockResolvedValue({ data: options?.rpc ?? [], error: options?.rpcError ?? null })
  return { client: { from, rpc } as unknown as ShipmentReviewBackend, from, select, eq, rpc }
}

describe('shipment review API client', () => {
  it('hides candidate support values that equal an unambiguous transcribed value', () => {
    const observation = (field_name: 'content_value' | 'content_unit' | 'unit_price_yen', normalized_value: unknown, candidate = false) => ({
      shipment_field_observation_id: `${field_name}-${normalized_value}-${candidate}`,
      field_name,
      raw_value: null,
      normalized_value,
      value_source: candidate ? 'rule_inferred' : 'image_read',
      confidence: 'low',
      review_status: 'proposed' as const,
      evidence: candidate ? { candidate_group_key: `${field_name}-${normalized_value}` } : {},
      recorded_at: '2026-09-12T00:00:00Z',
    })
    const row = {
      observations: [
        observation('content_value', '2'),
        observation('content_unit', '個'),
        ...Array.from({ length: 7 }, (_, index) => observation('content_value', '2', true)),
        ...Array.from({ length: 7 }, (_, index) => observation('content_unit', '個', true)),
        ...[116, 120, 129, 162, 200, 216, 280].map((price) => observation('unit_price_yen', price, true)),
      ],
    } as unknown as ShipmentReviewDbRow

    expect(actionableShipmentReviewCandidates(row).map((item) => item.field_name)).toEqual(
      Array(7).fill('unit_price_yen'),
    )

    const withoutTranscribedUnit = {
      ...row,
      observations: row.observations.filter((item) => !(
        item.field_name === 'content_unit' && Object.keys(item.evidence).length === 0
      )),
    } as ShipmentReviewDbRow
    expect(actionableShipmentReviewCandidates(withoutTranscribedUnit).map((item) => item.field_name)).toEqual([
      'content_unit',
      ...Array(7).fill('unit_price_yen'),
    ])
  })

  it('does not present an unaccepted candidate as the current field value', () => {
    const candidate = {
      shipment_field_observation_id: 'candidate-content',
      field_name: 'content_value',
      raw_value: null,
      normalized_value: '1',
      value_source: 'rule_inferred',
      confidence: 'medium',
      review_status: 'proposed' as const,
      evidence: { candidate_group_key: 'candidate-group' },
      recorded_at: '2026-09-12T00:00:00Z',
    }
    const row = { observations: [candidate] } as unknown as ShipmentReviewDbRow

    expect(primaryShipmentReviewObservation(row, 'content_value')).toBeNull()
    expect(actionableShipmentReviewCandidates(row)).toEqual([candidate])
  })

  it('enables finalization only when at least one row is approved and all rows are decided', () => {
    expect(canFinalizeShipmentReview([])).toBe(false)
    expect(canFinalizeShipmentReview([{ row_status: 'unreviewed' }])).toBe(false)
    expect(canFinalizeShipmentReview([{ row_status: 'approved' }, { row_status: 'deferred' }])).toBe(false)
    expect(canFinalizeShipmentReview([{ row_status: 'no_shipment' }])).toBe(false)
    expect(canFinalizeShipmentReview([{ row_status: 'approved' }, { row_status: 'no_shipment' }])).toBe(true)
  })

  it('advances after completed decisions except rejection', () => {
    expect(shipmentReviewDecisionAdvances('approve')).toBe(true)
    expect(shipmentReviewDecisionAdvances('defer')).toBe(true)
    expect(shipmentReviewDecisionAdvances('mark_no_shipment')).toBe(true)
    expect(shipmentReviewDecisionAdvances('reject_row')).toBe(false)
  })

  it('reads the shipment_input feature flag and fails closed for missing rows', async () => {
    const enabled = backend()
    await expect(createShipmentReviewApi(enabled.client).getFeatureEnabled()).resolves.toBe(true)
    expect(enabled.from).toHaveBeenCalledWith('app_features')
    expect(enabled.eq).toHaveBeenCalledWith('feature_key', 'shipment_input')

    const missing = backend({ feature: null })
    await expect(createShipmentReviewApi(missing.client).getFeatureEnabled()).rejects.toMatchObject({
      kind: 'invalid',
      retryable: false,
    })
  })

  it('uses only the review RPC boundary', async () => {
    const mock = backend({ rpc: { import_batch_id: 'batch-1', created: true } })
    const api = createShipmentReviewApi(mock.client)
    const bundle = { schema_version: 1 }
    await expect(api.importBundle(bundle)).resolves.toMatchObject({ import_batch_id: 'batch-1' })
    expect(mock.rpc).toHaveBeenCalledWith('import_shipment_review_bundle', { p_bundle: bundle })
  })

  it('passes optimistic status and request id to the action RPC', async () => {
    const mock = backend({ rpc: { row_status: 'in_review', duplicate: false } })
    const api = createShipmentReviewApi(mock.client)
    const action = {
      request_id: 'request-1',
      shipment_review_row_id: 'row-1',
      expected_row_status: 'unreviewed' as const,
      action_type: 'start_review' as const,
    }
    await api.applyAction(action)
    expect(mock.rpc).toHaveBeenCalledWith('apply_shipment_review_action', { p_action: action })
  })

  it('classifies permission, conflict, and retryable errors', async () => {
    for (const [message, kind, retryable] of [
      ['SHIPMENT_REVIEW_UNAUTHORIZED', 'permission', false],
      ['SHIPMENT_REVIEW_CONFLICT', 'conflict', true],
      ['Failed to fetch', 'retryable', true],
    ] as const) {
      const mock = backend({ rpcError: { message } })
      const error = await createShipmentReviewApi(mock.client).listBatches().catch((caught) => caught)
      expect(error).toBeInstanceOf(ShipmentReviewApiError)
      expect(error).toMatchObject({ kind, retryable })
    }
  })

  it('calls list, detail, and finalization RPCs with their declared arguments', async () => {
    const list = backend({ rpc: [] })
    await createShipmentReviewApi(list.client).listBatches()
    expect(list.rpc).toHaveBeenCalledWith('list_shipment_review_batches', undefined)

    const detail = backend({ rpc: { import_batch_id: 'batch-1' } })
    await createShipmentReviewApi(detail.client).getBatch('batch-1')
    expect(detail.rpc).toHaveBeenCalledWith('get_shipment_review_batch', { p_import_batch_id: 'batch-1' })

    const finalize = backend({ rpc: { duplicate: false } })
    await createShipmentReviewApi(finalize.client).finalize('batch-1')
    expect(finalize.rpc).toHaveBeenCalledWith('finalize_shipment_review_batch', { p_import_batch_id: 'batch-1' })
  })
})
