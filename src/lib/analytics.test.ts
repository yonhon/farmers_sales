import { describe, expect, it } from 'vitest'

import { aggregateProducts, filterByDate, summarizeSales } from './analytics'
import type { DailyProductSalesRow, DailySalesRow } from '../types'

const dailyRows: DailySalesRow[] = [
  {
    report_date: '2026-04-09',
    market_id: 'market-1',
    market_code: 'yanbaru_market',
    market_name: 'やんばる市場',
    sold_quantity: 5,
    gross_sales_yen: 1_400,
    discount_amount_yen: 100,
    net_sales_yen: 1_300,
  },
  {
    report_date: '2026-04-10',
    market_id: 'market-1',
    market_code: 'yanbaru_market',
    market_name: 'やんばる市場',
    sold_quantity: 3,
    gross_sales_yen: 900,
    discount_amount_yen: 0,
    net_sales_yen: 900,
  },
]

describe('analytics helpers', () => {
  it('filters rows using inclusive dates', () => {
    expect(filterByDate(dailyRows, '2026-04-10', '2026-04-10')).toHaveLength(1)
  })

  it('summarizes daily sales', () => {
    expect(summarizeSales(dailyRows)).toEqual({
      reportDays: 2,
      soldQuantity: 8,
      grossSalesYen: 2_300,
      discountAmountYen: 100,
      netSalesYen: 2_200,
      averageUnitRevenueYen: 275,
    })
  })

  it('aggregates and sorts products by net sales', () => {
    const rows: DailyProductSalesRow[] = [
      {
        report_date: '2026-04-09',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'トマト',
        sold_quantity: 2,
        gross_sales_yen: 600,
        discount_amount_yen: 0,
        net_sales_yen: 600,
      },
      {
        report_date: '2026-04-10',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'トマト',
        sold_quantity: 1,
        gross_sales_yen: 300,
        discount_amount_yen: 0,
        net_sales_yen: 300,
      },
      {
        report_date: '2026-04-10',
        market_id: 'market-1',
        product_id: 'product-b',
        canonical_name: 'オクラ',
        sold_quantity: 2,
        gross_sales_yen: 500,
        discount_amount_yen: 50,
        net_sales_yen: 450,
      },
    ]

    const result = aggregateProducts(rows)
    expect(result[0]).toMatchObject({
      canonicalName: 'トマト',
      soldQuantity: 3,
      netSalesYen: 900,
    })
    expect(result[1].canonicalName).toBe('オクラ')
  })
})
