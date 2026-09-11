import { describe, expect, it, vi } from 'vitest'

import {
  ShipmentReviewApiError,
  createShipmentReviewApi,
  type ShipmentReviewBackend,
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
