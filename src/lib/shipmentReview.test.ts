import { describe, expect, it } from 'vitest'

import {
  SHIPMENT_REVIEW_COLUMNS,
  hasRowChanged,
  isPriorityReviewItem,
  nextPendingIndex,
  parseShipmentReviewCsv,
  serializeReviewedShipments,
  sourcePageNumber,
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
  it('parses the monthly schema and preserves quoted values', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\r\n${csvRow({ comment: '確認,必要' }).replace('確認,必要', '"確認,必要"')}\r\n`
    const [item] = parseShipmentReviewCsv(text)

    expect(item.row.comment).toBe('確認,必要')
    expect(item.decision).toBe('pending')
    expect(sourcePageNumber(item.row.source_page)).toBe(4)
    expect(isPriorityReviewItem(item)).toBe(true)
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

  it('finds changes and advances to the next pending row once', () => {
    const text = `${SHIPMENT_REVIEW_COLUMNS.join(',')}\n${csvRow()}\n${csvRow({ source_row: '26' })}\n`
    const items = parseShipmentReviewCsv(text)
    items[0].row.total_package_quantity = '12'
    items[0].decision = 'approved'

    expect(hasRowChanged(items[0])).toBe(true)
    expect(nextPendingIndex(items, 0)).toBe(1)
  })
})
