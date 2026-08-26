import { useEffect, useMemo, useState } from 'react'
import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  subDays,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  aggregateWeekdays,
  buildProductDailySeries,
  calculateChangeRate,
  filterByDate,
  summarizeProduct,
} from '../lib/analytics'
import { supabase } from '../lib/supabase'
import type { DailyProductSalesRow, ProductSummary } from '../types'

const PAGE_SIZE = 1_000
const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})
const integer = new Intl.NumberFormat('ja-JP')
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('ja-JP', {
  style: 'percent',
  maximumFractionDigits: 1,
})

type ProductDetailProps = {
  productId: string
  productName: string
  startDate: string
  endDate: string
  productSummaries: ProductSummary[]
  totalNetSalesYen: number
  reportDates: string[]
  dashboardHref: string
}

async function fetchProductRows(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<DailyProductSalesRow[]> {
  if (!supabase) return []

  const rows: DailyProductSalesRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('analytics')
      .from('daily_product_sales')
      .select('*')
      .eq('product_id', productId)
      .gte('report_date', startDate)
      .lte('report_date', endDate)
      .order('report_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data ?? []) as DailyProductSalesRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function formatShortDate(value: string) {
  return format(parseISO(value), 'M/d', { locale: ja })
}

function formatLongDate(value: string) {
  return format(parseISO(value), 'yyyy年M月d日（E）', { locale: ja })
}

function formatChange(value: number | null) {
  if (value === null) return '比較不可'
  const sign = value > 0 ? '+' : ''
  return `${sign}${percent.format(value)}`
}

export function ProductDetail({
  productId,
  productName,
  startDate,
  endDate,
  productSummaries,
  totalNetSalesYen,
  reportDates,
  dashboardHref,
}: ProductDetailProps) {
  const [rows, setRows] = useState<DailyProductSalesRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const comparisonRange = useMemo(() => {
    const parsedStartDate = parseISO(startDate)
    const parsedEndDate = parseISO(endDate)
    if (!isValid(parsedStartDate) || !isValid(parsedEndDate) || startDate > endDate) {
      return null
    }

    const periodDays = differenceInCalendarDays(parsedEndDate, parsedStartDate) + 1
    const previousEnd = subDays(parsedStartDate, 1)
    return {
      previousStart: format(subDays(previousEnd, periodDays - 1), 'yyyy-MM-dd'),
      previousEnd: format(previousEnd, 'yyyy-MM-dd'),
    }
  }, [endDate, startDate])

  useEffect(() => {
    if (!comparisonRange) return

    const previousStart = comparisonRange.previousStart
    let active = true

    async function loadProduct() {
      setIsLoading(true)
      setErrorMessage('')
      try {
        const productRows = await fetchProductRows(
          productId,
          previousStart,
          endDate,
        )
        if (active) setRows(productRows)
      } catch (error) {
        if (!active) return
        console.error(error)
        setErrorMessage('商品別の分析データを取得できませんでした。')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void loadProduct()
    return () => {
      active = false
    }
  }, [comparisonRange, endDate, productId])

  const currentRows = useMemo(
    () => filterByDate(rows, startDate, endDate),
    [endDate, rows, startDate],
  )
  const previousRows = useMemo(
    () => comparisonRange
      ? filterByDate(rows, comparisonRange.previousStart, comparisonRange.previousEnd)
      : [],
    [comparisonRange, rows],
  )
  const current = useMemo(() => summarizeProduct(currentRows), [currentRows])
  const previous = useMemo(() => summarizeProduct(previousRows), [previousRows])
  const weekdays = useMemo(() => aggregateWeekdays(currentRows), [currentRows])
  const chartRows = useMemo(
    () => buildProductDailySeries(currentRows, reportDates),
    [currentRows, reportDates],
  )
  const priceValues = useMemo(
    () => chartRows.flatMap((row) => (
      row.average_unit_revenue_yen === null ? [] : [row.average_unit_revenue_yen]
    )),
    [chartRows],
  )
  const priceDomain = useMemo<[number, number]>(() => {
    if (!priceValues.length) return [0, 100]
    const minimum = Math.min(...priceValues)
    const maximum = Math.max(...priceValues)
    const padding = minimum === maximum
      ? Math.max(50, Math.round(maximum * 0.1))
      : Math.max(20, Math.round((maximum - minimum) * 0.12))
    return [Math.max(0, minimum - padding), maximum + padding]
  }, [priceValues])
  const salesRank = productSummaries.findIndex((product) => product.productId === productId) + 1
  const quantityRank = [...productSummaries]
    .sort((left, right) => right.soldQuantity - left.soldQuantity)
    .findIndex((product) => product.productId === productId) + 1
  const salesShare = totalNetSalesYen ? current.netSalesYen / totalNetSalesYen : 0

  if (!comparisonRange) {
    return (
      <div className="status-panel error" role="alert">
        日付範囲が不正です。商品別集計へ戻って期間を選び直してください。
      </div>
    )
  }

  if (isLoading) {
    return <div className="status-panel">{productName}の分析データを読み込んでいます…</div>
  }

  if (errorMessage) {
    return <div className="status-panel error" role="alert">{errorMessage}</div>
  }

  return (
    <div className="product-detail">
      <a className="back-link" href={dashboardHref}>← 商品別集計へ戻る</a>

      <section className="metric-grid product-metrics" aria-label={`${productName}の販売サマリー`}>
        <article className="metric-card accent">
          <p>純売上</p>
          <strong>{yen.format(current.netSalesYen)}</strong>
          <span>全体の{percent.format(salesShare)}</span>
        </article>
        <article className="metric-card">
          <p>販売個数</p>
          <strong>{integer.format(current.soldQuantity)}</strong>
          <span>1販売日平均 {decimal.format(current.averageSoldPerSellingDay)}個</span>
        </article>
        <article className="metric-card">
          <p>平均実売単価</p>
          <strong>{yen.format(current.averageUnitRevenueYen)}</strong>
          <span>純売上 ÷ 販売個数</span>
        </article>
        <article className="metric-card">
          <p>販売記録日数</p>
          <strong>{integer.format(current.sellingDays)}日</strong>
          <span>記録なしの日は含みません</span>
        </article>
        <article className="metric-card">
          <p>値引額・値引率</p>
          <strong>{yen.format(current.discountAmountYen)}</strong>
          <span>{percent.format(current.discountRate)}</span>
        </article>
        <article className="metric-card">
          <p>期間内順位</p>
          <strong>{salesRank || '—'}位</strong>
          <span>個数順位 {quantityRank || '—'}位 / {productSummaries.length}商品</span>
        </article>
      </section>

      <section className="comparison-strip" aria-label="直前期間との比較">
        <div>
          <span>比較対象</span>
          <strong>{formatShortDate(comparisonRange.previousStart)}〜{formatShortDate(comparisonRange.previousEnd)}</strong>
        </div>
        <div>
          <span>純売上</span>
          <strong>{formatChange(calculateChangeRate(current.netSalesYen, previous.netSalesYen))}</strong>
        </div>
        <div>
          <span>販売個数</span>
          <strong>{formatChange(calculateChangeRate(current.soldQuantity, previous.soldQuantity))}</strong>
        </div>
        <div>
          <span>平均実売単価</span>
          <strong>{formatChange(calculateChangeRate(current.averageUnitRevenueYen, previous.averageUnitRevenueYen))}</strong>
        </div>
      </section>

      {chartRows.length === 0 ? (
        <div className="status-panel">選択期間には、市場の販売報告がありません。</div>
      ) : (
        <>
          <section className="chart-grid product-chart-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">DAILY QUANTITY</p>
                  <h2>日別販売個数</h2>
                </div>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e6e9e2" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="report_date" tickFormatter={formatShortDate} minTickGap={24} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(label) => formatLongDate(String(label))}
                      formatter={(value) => [`${integer.format(Number(value))}個`, '販売個数']}
                    />
                    <Bar dataKey="sold_quantity" fill="#4d8b65" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">DAILY SALES</p>
                  <h2>日別純売上</h2>
                </div>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartRows} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="productNetSalesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#d29345" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#d29345" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e6e9e2" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="report_date" tickFormatter={formatShortDate} minTickGap={24} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1_000)}千`} />
                    <Tooltip
                      labelFormatter={(label) => formatLongDate(String(label))}
                      formatter={(value) => [yen.format(Number(value)), '純売上']}
                    />
                    <Area
                      type="monotone"
                      dataKey="net_sales_yen"
                      stroke="#c77f2e"
                      strokeWidth={2}
                      fill="url(#productNetSalesGradient)"
                      dot={false}
                      activeDot={{ r: 5, fill: '#c77f2e', stroke: '#fffdf7', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="chart-grid product-chart-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">UNIT REVENUE</p>
                  <h2>平均実売単価の推移</h2>
                </div>
                <span className="record-count">販売実績 {priceValues.length}日</span>
              </div>
              <div className="chart-wrap compact">
                {priceValues.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#e6e9e2" strokeDasharray="3 5" vertical={false} />
                      <XAxis
                        dataKey="report_date"
                        tickFormatter={formatShortDate}
                        minTickGap={24}
                      />
                      <YAxis
                        domain={priceDomain}
                        tickFormatter={(value) => `¥${integer.format(Number(value))}`}
                      />
                      <Tooltip
                        labelFormatter={(label) => formatLongDate(String(label))}
                        formatter={(value) => [yen.format(Number(value)), '平均実売単価']}
                      />
                      <ReferenceLine
                        y={current.averageUnitRevenueYen}
                        stroke="#8aa092"
                        strokeDasharray="5 5"
                        label={{
                          value: `期間平均 ${yen.format(current.averageUnitRevenueYen)}`,
                          position: 'insideTopRight',
                          fill: '#65756b',
                          fontSize: 11,
                        }}
                      />
                      <Line
                        type="linear"
                        dataKey="average_unit_revenue_yen"
                        name="平均実売単価"
                        stroke="#375f4c"
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 3, fill: '#375f4c', stroke: '#375f4c', strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: '#375f4c', stroke: '#375f4c', strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    平均実売単価を算出できる販売実績がありません。
                  </div>
                )}
              </div>
              <p className="data-note">●は販売実績のある日を示します。線は実績のある日同士を結んでいます。</p>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">WEEKDAY PATTERN</p>
                  <h2>曜日別の平均販売個数</h2>
                </div>
                <span className="record-count">販売記録日の平均</span>
              </div>
              <div className="chart-wrap compact">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdays} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e6e9e2" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="weekdayLabel" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${decimal.format(Number(value))}個`, '1販売日平均']} />
                    <Bar dataKey="averageSoldQuantity" fill="#8cac75" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">DAILY RECORDS</p>
                <h2>日別明細</h2>
              </div>
              <span className="record-count">{chartRows.length}日分</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>販売個数</th>
                    <th>粗売上</th>
                    <th>値引額</th>
                    <th>純売上</th>
                    <th>平均実売単価</th>
                  </tr>
                </thead>
                <tbody>
                  {chartRows.map((row) => (
                    <tr key={row.report_date}>
                      <td>{formatLongDate(row.report_date)}</td>
                      <td>{integer.format(Number(row.sold_quantity))}</td>
                      <td>{yen.format(Number(row.gross_sales_yen))}</td>
                      <td>{yen.format(Number(row.discount_amount_yen))}</td>
                      <td><strong>{yen.format(Number(row.net_sales_yen))}</strong></td>
                      <td>
                        {row.average_unit_revenue_yen === null
                          ? '—'
                          : yen.format(row.average_unit_revenue_yen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="data-note">
              市場全体の販売報告がある日に商品明細がなかった場合は、販売個数・売上を0として表示しています。
            </p>
          </section>
        </>
      )}
    </div>
  )
}
