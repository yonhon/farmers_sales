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

export type DailyProductWeightedPriceRow = {
  report_date: string
  product_id: string
  canonical_name: string
  converted_package_quantity: number
  sold_weight_kg: number
  converted_net_sales_yen: number
  average_kg_unit_revenue_yen: number | null
  unconverted_package_quantity: number
  uses_standard_weight: boolean | null
}

export type DailyProductShipmentBalanceRow = {
  shipment_date: string
  product_id: string
  canonical_name: string
  shipment_package_quantity: number
  allocated_package_quantity: number
  remaining_package_quantity: number
  sell_through_rate: number
  shipment_lot_count: number
  sales_data_through_date: string | null
}

export type WeightedKgPriceSummary = {
  soldWeightKg: number
  convertedNetSalesYen: number
  averageKgUnitRevenueYen: number | null
  unconvertedPackageQuantity: number
  usesStandardWeight: boolean
}

export type ShipmentBalanceSeriesRow = {
  shipment_date: string
  shipment_package_quantity: number
  allocated_package_quantity: number
  remaining_package_quantity: number
  remaining_rate: number
  sales_data_through_date: string | null
}
