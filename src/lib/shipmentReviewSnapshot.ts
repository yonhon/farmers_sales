import type { ShipmentReviewBatch } from './shipmentReviewClient'

export const SHIPMENT_REVIEW_SNAPSHOT_SCHEMA_VERSION = 1

export type ShipmentReviewSnapshot = {
  snapshot_schema_version: typeof SHIPMENT_REVIEW_SNAPSHOT_SCHEMA_VERSION
  exported_at: string
  source: 'get_shipment_review_batch'
  batch: ShipmentReviewBatch
}

export function createShipmentReviewSnapshot(
  batch: ShipmentReviewBatch,
  exportedAt = new Date(),
): ShipmentReviewSnapshot {
  return {
    snapshot_schema_version: SHIPMENT_REVIEW_SNAPSHOT_SCHEMA_VERSION,
    exported_at: exportedAt.toISOString(),
    source: 'get_shipment_review_batch',
    batch,
  }
}

export function serializeShipmentReviewSnapshot(
  batch: ShipmentReviewBatch,
  exportedAt = new Date(),
) {
  return `${JSON.stringify(createShipmentReviewSnapshot(batch, exportedAt), null, 2)}\n`
}

export function shipmentReviewSnapshotFilename(batch: ShipmentReviewBatch) {
  return `shipment_review_db_snapshot_${batch.source_month.slice(0, 7)}.json`
}
