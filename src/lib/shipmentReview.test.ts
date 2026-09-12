import { describe, expect, it } from 'vitest'

import {
  SHIPMENT_REVIEW_COLUMNS,
  canExportReviewedShipments,
  completeShipmentContentUnit,
  decideShipmentReviewItem,
  hasRowChanged,
  inferShipmentContentUnit,
  isPriorityReviewItem,
  nextPendingIndex,
  parseShipmentReviewCsv,
  restoreShipmentReviewItems,
  serializeReviewedShipments,
  shipmentReviewStorageKey,
  sourcePageNumber,
  updateShipmentReviewItem,
} from './shipmentReview'

function csvRow(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    source_page: 'scan-04.jpg',
    source_row: '25',
    shipment_date: '2026/8/24',
    market_code: 'yanbaru_market',
    raw_product_name: 'バジル',
    resolved_product_name: 'バジル',
    raw_content: '80',
    content_value: '80',
    content_unit: 'g',
    unit_price_yen: '250',
    total_package_quantity: '',
    destination: 'farmers',
    raw_notes: 'お徳用',
    review_required: 'TRUE',
    review_note: '袋数が未記入',
    comment: '',
    ...overrides,
  }
  return SHIPMENT_REVIEW_COLUMNS.map((column) => values[column]).join(',')
}

describe('shipment review CSV', () => {
  it('infers a missing content unit from the content value', () => {
    expect(inferShipmentContentUnit('2', 'パプリカ')).toBe('個')
    expect(inferShipmentContentUnit('2', 'ゴーヤー')).toBe('本')
    expect(inferShipmentContentUnit('10', '大葉')).toBe('枚')
    expect(inferShipmentContentUnit('29.9', '未登録品目')).toBe('')
    expect(inferShipmentContentUnit('30')).toBe('g')
    expect(inferShipmentContentUnit('100')).toBe('g')
    expect(inferShipmentContentUnit('')).toBe('')
    expect(inferShipmentContentUnit('不明', 'パプリカ')).toBe('')
  })

  it('preserves a unit that the reviewer explicitly cleared', () => {
    expect(completeShipmentContentUnit('', '2', 'パプリカ')).toBe('個')
    expect(completeShipmentContentUnit('', '2', 'パプリカ', true)).toBe('')
    expect(completeShipmentContentUnit('', '100', '未登録品目', true)).toBe('')
  })

  it('parses the monthly schema and preserves quoted values', () => {
    const text = `\uFEFF${SHIPMENT_REVIEW_COLUMNS.join(',')}\r\n${csvRow({ comment: '確認,必要' }).replace('確認,必要', '"確認,必要"')}\r\n`
    const [item] = parseShipmentReviewCsv(text)

    expect(item.row.comment).toBe('確認,必要')
    expect(item.decision).toBe('pending')
    expect(sourcePageNumber(item.row.source_page)).toBe(4)
    expect(isPriorityReviewItem(item)).toBe(true)
  })

  it('restores an already approved row from the confirmed CSV', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow({ review_required: 'FALSE' })}\n`
    const [item] = parseShipmentReviewCsv(text)

    expect(item.decision).toBe('approved')
    expect(canExportReviewedShipments([item])).toBe(true)
  })

  it('rejects a CSV without the required schema', () => {
    expect(() => parseShipmentReviewCsv('source_page,source_row\na.jpg,1\n'))
      .toThrow('必要な列がありません')
  })

  it('exports approved rows and omits rows marked as no shipment', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n${csvRow({ source_row: '26' })}\n`
    const items = parseShipmentReviewCsv(text)
    items[0].decision = 'approved'
    items[1].decision = 'excluded'

    const output = serializeReviewedShipments(items)
    expect(output).toContain('FALSE')
    expect(output).not.toContain(',26,')
  })

  it('blocks export while a row is pending or held', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n${csvRow({ source_row: '26' })}\n`
    const items = parseShipmentReviewCsv(text)

    expect(canExportReviewedShipments(items)).toBe(false)
    items[0].decision = 'approved'
    items[1].decision = 'held'
    expect(canExportReviewedShipments(items)).toBe(false)
    items[1].decision = 'excluded'
    expect(canExportReviewedShipments(items)).toBe(true)
  })

  it('keeps a held row in the CSV as review required when serialized directly', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n`
    const items = parseShipmentReviewCsv(text)
    items[0].decision = 'held'

    const [serialized] = parseShipmentReviewCsv(serializeReviewedShipments(items))
    expect(serialized.decision).toBe('pending')
    expect(serialized.row.review_required).toBe('TRUE')
  })

  it('returns an approved row to pending after an edit and advances after a decision', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow({ review_required: 'FALSE' })}\n${csvRow({ source_row: '26' })}\n`
    const items = parseShipmentReviewCsv(text)
    const edited = updateShipmentReviewItem(items, 0, 'total_package_quantity', '12')

    expect(edited[0].decision).toBe('pending')
    expect(edited[0].row.total_package_quantity).toBe('12')
    const decided = decideShipmentReviewItem(edited, 0, 'approved')
    expect(decided.items[0].decision).toBe('approved')
    expect(decided.nextIndex).toBe(1)
  })

  it('restores local edits and decisions by the stable CSV file identity', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n${csvRow({ source_row: '26' })}\n`
    const parsed = parseShipmentReviewCsv(text)
    const saved = [{
      id: parsed[0].id,
      row: { ...parsed[0].row, resolved_product_name: '青パプリカ' },
      decision: 'held' as const,
    }]

    const restored = restoreShipmentReviewItems(parsed, saved)
    expect(shipmentReviewStorageKey({ name: 'june.csv', size: 100, lastModified: 123 }))
      .toBe('shipment-review:v1:june.csv:100:123')
    expect(restored[0].row.resolved_product_name).toBe('青パプリカ')
    expect(restored[0].decision).toBe('held')
    expect(restored[1]).toEqual(parsed[1])
  })

  it('finds changes and advances to the next pending row once', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n${csvRow({ source_row: '26' })}\n`
    const items = parseShipmentReviewCsv(text)
    items[0].row.total_package_quantity = '12'
    items[0].decision = 'approved'

    expect(hasRowChanged(items[0])).toBe(true)
    expect(nextPendingIndex(items, 0)).toBe(1)
  })
})
