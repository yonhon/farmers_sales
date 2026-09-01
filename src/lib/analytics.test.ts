import { describe, expect, it } from 'vitest'

import {
  aggregateProducts,
  aggregateWeekdays,
  buildProductDailySeries,
  buildShipmentBalanceSeries,
  calculateChangeRate,
  filterByDate,
  summarizeProduct,
  summarizeSales,
  summarizeWeightedKgPrices,
} from './analytics'
import type {
  DailyProductSalesRow,
  DailyProductShipmentBalanceRow,
  DailyProductWeightedPriceRow,
  DailySalesRow,
} from '../types'

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

  it('summarizes one product and calculates realized unit revenue', () => {
    const rows: DailyProductSalesRow[] = [
      {
        report_date: '2026-04-09',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'トマト',
        sold_quantity: 2,
        gross_sales_yen: 700,
        discount_amount_yen: 100,
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
    ]

    expect(summarizeProduct(rows)).toEqual({
      sellingDays: 2,
      soldQuantity: 3,
      grossSalesYen: 1_000,
      discountAmountYen: 100,
      netSalesYen: 900,
      averageUnitRevenueYen: 300,
      averageSoldPerSellingDay: 1.5,
      discountRate: 0.1,
    })
  })

  it('aggregates weekday averages using selling days only', () => {
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
        report_date: '2026-04-16',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'トマト',
        sold_quantity: 4,
        gross_sales_yen: 1_200,
        discount_amount_yen: 0,
        net_sales_yen: 1_200,
      },
    ]

    expect(aggregateWeekdays(rows)).toEqual([
      expect.objectContaining({
        weekdayLabel: '木曜',
        sellingDays: 2,
        averageSoldQuantity: 3,
        averageNetSalesYen: 900,
      }),
    ])
  })

  it('counts one selling day when the same date appears in multiple markets', () => {
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
        report_date: '2026-04-09',
        market_id: 'market-2',
        product_id: 'product-a',
        canonical_name: 'トマト',
        sold_quantity: 3,
        gross_sales_yen: 900,
        discount_amount_yen: 0,
        net_sales_yen: 900,
      },
    ]
    const salesRows: DailySalesRow[] = rows.map((row, index) => ({
      report_date: row.report_date,
      market_id: row.market_id,
      market_code: `market-${index + 1}`,
      market_name: `市場${index + 1}`,
      sold_quantity: row.sold_quantity,
      gross_sales_yen: row.gross_sales_yen,
      discount_amount_yen: row.discount_amount_yen,
      net_sales_yen: row.net_sales_yen,
    }))

    expect(summarizeSales(salesRows)).toMatchObject({
      reportDays: 1,
      soldQuantity: 5,
      netSalesYen: 1_500,
    })
    expect(summarizeProduct(rows)).toMatchObject({
      sellingDays: 1,
      soldQuantity: 5,
      averageSoldPerSellingDay: 5,
    })
    expect(aggregateWeekdays(rows)).toEqual([
      expect.objectContaining({
        weekdayLabel: '木曜',
        sellingDays: 1,
        averageSoldQuantity: 5,
        averageNetSalesYen: 1_500,
      }),
    ])
  })

  it('returns null when a previous-period change cannot be calculated', () => {
    expect(calculateChangeRate(120, 100)).toBeCloseTo(0.2)
    expect(calculateChangeRate(120, 0)).toBeNull()
  })

  it('fills market report dates without product sales with zero', () => {
    const rows: DailyProductSalesRow[] = [
      {
        report_date: '2026-06-18',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'ゴーヤー',
        sold_quantity: 2,
        gross_sales_yen: 600,
        discount_amount_yen: 0,
        net_sales_yen: 600,
      },
      {
        report_date: '2026-08-19',
        market_id: 'market-1',
        product_id: 'product-a',
        canonical_name: 'ゴーヤー',
        sold_quantity: 3,
        gross_sales_yen: 900,
        discount_amount_yen: 0,
        net_sales_yen: 900,
      },
    ]

    const result = buildProductDailySeries(
      rows,
      ['2026-06-18', '2026-06-19', '2026-06-20', '2026-08-19'],
    )

    expect(result).toHaveLength(4)
    expect(result[1]).toEqual({
      report_date: '2026-06-19',
      sold_quantity: 0,
      gross_sales_yen: 0,
      discount_amount_yen: 0,
      net_sales_yen: 0,
      average_unit_revenue_yen: null,
    })
    expect(result[3].average_unit_revenue_yen).toBe(300)
  })
})

describe('shipment analytics', () => {
  it('calculates the period kg price from total revenue and total weight', () => {
    const rows: DailyProductWeightedPriceRow[] = [
      {
        report_date: '2026-07-14',
        product_id: 'product-a',
        canonical_name: 'オクラ',
        converted_package_quantity: 2,
        sold_weight_kg: 0.2,
        converted_net_sales_yen: 300,
        average_kg_unit_revenue_yen: 1500,
        unconverted_package_quantity: 0,
        uses_standard_weight: false,
        weight_standard_details: [],
      },
      {
        report_date: '2026-07-15',
        product_id: 'product-a',
        canonical_name: 'オクラ',
        converted_package_quantity: 4,
        sold_weight_kg: 0.8,
        converted_net_sales_yen: 800,
        average_kg_unit_revenue_yen: 1000,
        unconverted_package_quantity: 1,
        uses_standard_weight: true,
        weight_standard_details: [
          {
            grams_per_unit: 166.667,
            unit_code: 'piece',
            confidence: 'estimated',
            source: '山形県青果物等標準出荷規格集（令和8年4月）',
            notes: '実際の出荷サイズは確認できないため、Mサイズを代表値として換算しています。',
          },
        ],
      },
    ]

    expect(summarizeWeightedKgPrices(rows)).toEqual({
      soldWeightKg: 1,
      convertedNetSalesYen: 1100,
      averageKgUnitRevenueYen: 1100,
      unconvertedPackageQuantity: 1,
      usesStandardWeight: true,
      weightStandardDetails: [
        {
          grams_per_unit: 166.667,
          unit_code: 'piece',
          confidence: 'estimated',
          source: '山形県青果物等標準出荷規格集（令和8年4月）',
          notes: '実際の出荷サイズは確認できないため、Mサイズを代表値として換算しています。',
        },
      ],
    })
  })

  it('sorts shipment dates and calculates remaining rates', () => {
    const rows: DailyProductShipmentBalanceRow[] = [
      {
        shipment_date: '2026-07-15',
        product_id: 'product-a',
        canonical_name: 'オクラ',
        shipment_package_quantity: 20,
        allocated_package_quantity: 15,
        remaining_package_quantity: 5,
        sell_through_rate: 0.75,
        shipment_lot_count: 1,
        sales_data_through_date: '2026-07-20',
      },
      {
        shipment_date: '2026-07-14',
        product_id: 'product-a',
        canonical_name: 'オクラ',
        shipment_package_quantity: 10,
        allocated_package_quantity: 4,
        remaining_package_quantity: 6,
        sell_through_rate: 0.4,
        shipment_lot_count: 1,
        sales_data_through_date: '2026-07-20',
      },
    ]

    const result = buildShipmentBalanceSeries(rows)
    expect(result.map((row) => row.shipment_date)).toEqual(['2026-07-14', '2026-07-15'])
    expect(result[0].remaining_rate).toBe(0.6)
  })
})
