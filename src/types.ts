export type DailySalesRow = {
  report_date: string
  market_id: string
  market_code: string
  market_name: string
  sold_quantity: number
  gross_sales_yen: number
  discount_amount_yen: number
  net_sales_yen: number
}

export type DailyProductSalesRow = {
  report_date: string
  market_id: string
  product_id: string
  canonical_name: string
  sold_quantity: number
  gross_sales_yen: number
  discount_amount_yen: number
  net_sales_yen: number
}

export type ProductSummary = {
  productId: string
  canonicalName: string
  soldQuantity: number
  grossSalesYen: number
  discountAmountYen: number
  netSalesYen: number
}

export type SalesSummary = {
  reportDays: number
  soldQuantity: number
  grossSalesYen: number
  discountAmountYen: number
  netSalesYen: number
  averageUnitRevenueYen: number
}

export type ProductAnalysisSummary = {
  sellingDays: number
  soldQuantity: number
  grossSalesYen: number
  discountAmountYen: number
  netSalesYen: number
  averageUnitRevenueYen: number
  averageSoldPerSellingDay: number
  discountRate: number
}

export type WeekdaySummary = {
  weekdayIndex: number
  weekdayLabel: string
  sellingDays: number
  soldQuantity: number
  netSalesYen: number
  averageSoldQuantity: number
  averageNetSalesYen: number
}

export type ProductDailySeriesRow = {
  report_date: string
  sold_quantity: number
  gross_sales_yen: number
  discount_amount_yen: number
  net_sales_yen: number
  average_unit_revenue_yen: number | null
}
