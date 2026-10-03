import { describe, expect, it } from 'vitest'

import { groupMarkdownMatches, markdownLabel, markdownRatePercent, splitPartPosition } from './shipmentMarkdown'

describe('markdown sticker display helpers', () => {
  it('labels a stickered row with its list price, sticker price, and rate', () => {
    expect(markdownLabel(270, 135)).toBe('値引分（定価270円 → シール135円・50%引）')
    expect(markdownLabel('216', '151')).toBe('値引分（定価216円 → シール151円・30%引）')
    expect(markdownLabel(270, null)).toBeNull()
    expect(markdownRatePercent(324, 162)).toBe(50)
  })

  it('numbers the parts of a split ledger row and ignores unsplit rows', () => {
    const rows = [
      { source_page: 'p09', source_row: 1, source_part: 0 },
      { source_page: 'p09', source_row: 1, source_part: 1 },
      { source_page: 'p09', source_row: 2, source_part: 0 },
    ]
    expect(splitPartPosition(rows[0], rows)).toBe('1/2')
    expect(splitPartPosition(rows[1], rows)).toBe('2/2')
    expect(splitPartPosition(rows[2], rows)).toBeNull()
  })

  it('groups matching discounted sales by list price', () => {
    const match = (report_date: string, sales_unit_price_yen: number) => ({
      report_date,
      sales_unit_price_yen,
      sold_quantity: 2,
      discount_amount_yen: 108,
      discounted_quantity: 1,
      discount_per_unit_yen: 108,
      discount_rate_percent: 50,
    })
    expect(groupMarkdownMatches([match('2026-06-10', 216), match('2026-06-15', 216)])).toEqual([
      { listPrice: 216, discountPerUnit: 108, rate: 50, dates: ['2026-06-10', '2026-06-15'], discountedUnits: 2 },
    ])
  })
})
