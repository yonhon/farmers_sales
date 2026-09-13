import { describe, expect, it } from 'vitest'

import type { ShipmentReviewBatch } from './shipmentReviewClient'
import {
  createShipmentReviewSnapshot,
  serializeShipmentReviewSnapshot,
  shipmentReviewSnapshotFilename,
} from './shipmentReviewSnapshot'

const batch = {
  import_batch_id: 'batch-1',
  bundle_sha256: 'abc123',
  bundle_schema_version: 2,
  source_month: '2026-06-01',
  report_version: 1,
  validator_version: 'validator-v1',
  lookahead_days: 7,
  reference_snapshot_id: 'snapshot-1',
  finalized_at: null,
  finalization_result: null,
  rows: [{
    shipment_review_row_id: 'row-1',
    import_batch_id: 'batch-1',
    source_page: 'page.jpg',
    source_row: 1,
    row_status: 'deferred',
    shipment_date: '2026-06-01',
    market_code: 'market',
    destination: 'farmers',
    raw_notes: null,
    review_note: '確認が必要',
    comment: null,
    linked_shipment_line_id: null,
    observations: [],
    issues: [],
    actions: [{
      shipment_review_action_id: 'action-1',
      action_type: 'defer',
      field_name: null,
      from_status: 'in_review',
      to_status: 'deferred',
      notes: '販売実績と不一致',
      acted_at: '2026-09-01T00:00:00Z',
      request_id: 'request-1',
    }],
  }],
} as ShipmentReviewBatch

describe('shipment review snapshot', () => {
  it('preserves the complete RPC response, including fields beyond the UI type', () => {
    const snapshot = createShipmentReviewSnapshot(batch, new Date('2026-09-13T00:00:00Z'))

    expect(snapshot.snapshot_schema_version).toBe(1)
    expect(snapshot.exported_at).toBe('2026-09-13T00:00:00.000Z')
    expect(snapshot.batch.bundle_sha256).toBe('abc123')
    expect(snapshot.batch.rows[0].actions[0].request_id).toBe('request-1')
  })

  it('serializes with a trailing newline and a month-specific filename', () => {
    const serialized = serializeShipmentReviewSnapshot(batch, new Date('2026-09-13T00:00:00Z'))

    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized).batch.rows[0].actions[0].notes).toBe('販売実績と不一致')
    expect(shipmentReviewSnapshotFilename(batch)).toBe('shipment_review_db_snapshot_2026-06.json')
  })
})
