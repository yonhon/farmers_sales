import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { aggregateProducts, filterByDate, summarizeSales } from '../lib/analytics'
import { supabase } from '../lib/supabase'
import type { DailyProductSalesRow, DailySalesRow } from '../types'
import { ProductDetail } from './ProductDetail'
import { SalesImport } from './SalesImport'

const PAGE_SIZE = 1_000
const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})
const integer = new Intl.NumberFormat('ja-JP')

async function fetchAllRows<T>(
  table: 'daily_sales_summary' | 'daily_product_sales',
): Promise<T[]> {
  if (!supabase) return []

  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('analytics')
      .from(table)
      .select('*')
      .order('report_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function formatShortDate(value: string) {
  return format(parseISO(value), 'M/d', { locale: ja })
}

type HashRoute = {
  productId: string | null
  isImport: boolean
  startDate: string
  endDate: string
}

function readHashRoute(): HashRoute {
  const [path, query = ''] = (window.location.hash.slice(1) || '/').split('?')
  const match = path.match(/^\/products\/([^/]+)$/)
  const params = new URLSearchParams(query)
  return {
    productId: match ? decodeURIComponent(match[1]) : null,
    isImport: path === '/sales/import',
    startDate: params.get('from') ?? '',
    endDate: params.get('to') ?? '',
  }
}

function buildHashHref(productId: string | null, startDate: string, endDate: string) {
  const params = new URLSearchParams()
  if (startDate) params.set('from', startDate)
  if (endDate) params.set('to', endDate)
  const path = productId ? `/products/${encodeURIComponent(productId)}` : '/'
  const query = params.toString()
  return `#${path}${query ? `?${query}` : ''}`
}

type DashboardProps = {
  userId: string
  onSignOut: () => Promise<void>
}

type ProductSortKey = 'canonicalName' | 'soldQuantity' | 'grossSalesYen' | 'discountAmountYen' | 'netSalesYen'
type SortDirection = 'ascending' | 'descending'

export function Dashboard({ userId, onSignOut }: DashboardProps) {
  const initialRoute = readHashRoute()
  const [dailyRows, setDailyRows] = useState<DailySalesRow[]>([])
  const [productRows, setProductRows] = useState<DailyProductSalesRow[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialRoute.productId)
  const [isImportRoute, setIsImportRoute] = useState(initialRoute.isImport)
  const [startDate, setStartDate] = useState(initialRoute.startDate)
  const [endDate, setEndDate] = useState(initialRoute.endDate)
  const [appRole, setAppRole] = useState('viewer')
  const [displayName, setDisplayName] = useState('ログインユーザー')
  const [productSort, setProductSort] = useState<{
    key: ProductSortKey
    direction: SortDirection
  }>({ key: 'netSalesYen', direction: 'descending' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    function syncRoute() {
      const route = readHashRoute()
      setSelectedProductId(route.productId)
      setIsImportRoute(route.isImport)
      if (route.startDate) setStartDate(route.startDate)
      if (route.endDate) setEndDate(route.endDate)
    }

    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    let active = true

    async function loadDashboard() {
      setIsLoading(true)
      setErrorMessage('')
      try {
        if (!supabase) return
        const [daily, products, roleResponse] = await Promise.all([
          fetchAllRows<DailySalesRow>('daily_sales_summary'),
          fetchAllRows<DailyProductSalesRow>('daily_product_sales'),
          supabase.from('app_users').select('app_role, display_name').eq('user_id', userId).single(),
        ])
        if (roleResponse.error) throw roleResponse.error
        if (!active) return
        setDailyRows(daily)
        setProductRows(products)
        setAppRole(String(roleResponse.data.app_role))
        setDisplayName(String(roleResponse.data.display_name))
        if (daily.length) {
          setStartDate((current) => current || daily[0].report_date)
          setEndDate((current) => current || daily[daily.length - 1].report_date)
        }
      } catch (error) {
        if (!active) return
        console.error(error)
        setErrorMessage(
          '集計データを取得できませんでした。analyticsスキーマのData API設定とRLSを確認してください。ブラウザをリロードしてみてください。',
        )
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void loadDashboard()
    return () => {
      active = false
    }
  }, [refreshKey, userId])

  const filteredDaily = useMemo(
    () => filterByDate(dailyRows, startDate, endDate),
    [dailyRows, startDate, endDate],
  )
  const filteredProducts = useMemo(
    () => filterByDate(productRows, startDate, endDate),
    [productRows, startDate, endDate],
  )
  const summary = useMemo(() => summarizeSales(filteredDaily), [filteredDaily])
  const productSummary = useMemo(
    () => aggregateProducts(filteredProducts),
    [filteredProducts],
  )
  const topProducts = productSummary.slice(0, 10)
  const sortedProductSummary = useMemo(() => {
    const direction = productSort.direction === 'ascending' ? 1 : -1
    return [...productSummary].sort((left, right) => {
      if (productSort.key === 'canonicalName') {
        return left.canonicalName.localeCompare(right.canonicalName, 'ja') * direction
      }
      return (left[productSort.key] - right[productSort.key]) * direction
    })
  }, [productSort, productSummary])
  const reportDates = useMemo(
    () => [...new Set(filteredDaily.map((row) => row.report_date))].sort(),
    [filteredDaily],
  )
  const marketName = dailyRows[0]?.market_name ?? 'やんばる市場'
  const selectedProductName = productRows.find(
    (row) => row.product_id === selectedProductId,
  )?.canonical_name ?? '商品'
  const dashboardHref = buildHashHref(null, startDate, endDate)

  function updateDateRange(nextStartDate: string, nextEndDate: string) {
    setStartDate(nextStartDate)
    setEndDate(nextEndDate)
    window.history.replaceState(
      null,
      '',
      buildHashHref(selectedProductId, nextStartDate, nextEndDate),
    )
  }

  function updateProductSort(key: ProductSortKey) {
    setProductSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'ascending'
        ? 'descending'
        : 'ascending',
    }))
  }

  function sortIndicator(key: ProductSortKey) {
    if (productSort.key !== key) return '↕'
    return productSort.direction === 'ascending' ? '↑' : '↓'
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand-lockup" href={dashboardHref} aria-label="全体の販売状況へ戻る">
          <span className="brand-icon" aria-hidden="true">農</span>
          <div>
            <p>NODAI FARMERS MARKET</p>
            <strong>Sales Dashboard</strong>
          </div>
        </a>
        <div className="user-actions">
          {appRole === 'admin' || appRole === 'inputter' ? (
            <a className="header-link" href={isImportRoute ? dashboardHref : '#/sales/import'}>
              {isImportRoute ? 'ダッシュボード' : 'データ登録'}
            </a>
          ) : null}
          <span>{displayName}</span>
          <button className="text-button" type="button" onClick={() => void onSignOut()}>
            ログアウト
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-heading">
          <div>
            <p className="eyebrow">{isImportRoute ? 'DATA IMPORT' : marketName}</p>
            <h1>
              {isImportRoute
                ? '売上状況を一括登録'
                : selectedProductId ? `${selectedProductName}の販売状況` : '全体の販売状況'}
            </h1>
            <p className="muted">
              {isImportRoute
                ? '対象年を選び、複数日分の売上状況をそのまま貼り付けてください。'
                : selectedProductId
                ? '販売実績の推移と曜日傾向を、選択した期間で確認できます。'
                : '日々の販売量と売上を、商品ごとに見渡せます。'}
            </p>
          </div>
          {!isImportRoute && <div className="date-filter" aria-label="表示期間">
            <label>
              開始日
              <input
                type="date"
                value={startDate}
                min={dailyRows[0]?.report_date}
                max={endDate || undefined}
                onChange={(event) => updateDateRange(event.target.value, endDate)}
              />
            </label>
            <span aria-hidden="true">—</span>
            <label>
              終了日
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                max={dailyRows[dailyRows.length - 1]?.report_date}
                onChange={(event) => updateDateRange(startDate, event.target.value)}
              />
            </label>
          </div>}
        </section>

        {isLoading && <div className="status-panel">集計データを読み込んでいます…</div>}
        {errorMessage && <div className="status-panel error" role="alert">{errorMessage}</div>}

        {!isLoading && !errorMessage && (
          isImportRoute ? (
            <SalesImport
              appRole={appRole}
              onImported={(firstDate, lastDate) => {
                setStartDate(firstDate)
                setEndDate(lastDate)
                setRefreshKey((current) => current + 1)
              }}
            />
          ) : selectedProductId ? (
            <ProductDetail
              productId={selectedProductId}
              productName={selectedProductName}
              startDate={startDate}
              endDate={endDate}
              productSummaries={productSummary}
              totalNetSalesYen={summary.netSalesYen}
              reportDates={reportDates}
              dashboardHref={dashboardHref}
            />
          ) : (
          <>
            <section className="metric-grid" aria-label="販売サマリー">
              <article className="metric-card accent">
                <p>純売上</p>
                <strong>{yen.format(summary.netSalesYen)}</strong>
                <span>{summary.reportDays}日分の集計</span>
              </article>
              <article className="metric-card">
                <p>販売個数</p>
                <strong>{integer.format(summary.soldQuantity)}</strong>
                <span>平均 {integer.format(summary.averageUnitRevenueYen)}円／個</span>
              </article>
              <article className="metric-card">
                <p>値引額</p>
                <strong>{yen.format(summary.discountAmountYen)}</strong>
                <span>粗売上 {yen.format(summary.grossSalesYen)}</span>
              </article>
              <article className="metric-card">
                <p>取扱商品</p>
                <strong>{integer.format(productSummary.length)}</strong>
                <span>期間内の商品数</span>
              </article>
            </section>

            <section className="chart-grid">
              <article className="panel wide">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">DAILY TREND</p>
                    <h2>日別純売上</h2>
                  </div>
                  <span className="legend"><i /> 純売上</span>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={filteredDaily} margin={{ top: 16, right: 12, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4d8b65" stopOpacity={0.42} />
                          <stop offset="100%" stopColor="#4d8b65" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#dfe4da" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="report_date" tickFormatter={formatShortDate} minTickGap={28} />
                      <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} width={42} />
                      <Tooltip
                        labelFormatter={(value) => format(parseISO(String(value)), 'yyyy年M月d日', { locale: ja })}
                        formatter={(value) => [yen.format(Number(value)), '純売上']}
                      />
                      <Area
                        type="monotone"
                        dataKey="net_sales_yen"
                        stroke="#2f6b4c"
                        strokeWidth={2.5}
                        fill="url(#salesFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">TOP PRODUCTS</p>
                    <h2>商品別売上</h2>
                  </div>
                </div>
                <div className="chart-wrap compact">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProducts} layout="vertical" margin={{ top: 4, right: 12, left: 18, bottom: 0 }}>
                      <CartesianGrid stroke="#e6e9e2" strokeDasharray="3 5" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="canonicalName"
                        width={112}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip formatter={(value) => [yen.format(Number(value)), '純売上']} />
                      <Bar dataKey="netSalesYen" fill="#d29345" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </section>

            <section className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">PRODUCT DETAIL</p>
                  <h2>商品別集計</h2>
                </div>
                <span className="record-count">{productSummary.length}商品</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th aria-sort={productSort.key === 'canonicalName' ? productSort.direction : 'none'}>
                        <button className="sort-button" type="button" onClick={() => updateProductSort('canonicalName')}>
                          商品名 <span>{sortIndicator('canonicalName')}</span>
                        </button>
                      </th>
                      <th aria-sort={productSort.key === 'soldQuantity' ? productSort.direction : 'none'}>
                        <button className="sort-button" type="button" onClick={() => updateProductSort('soldQuantity')}>
                          販売個数 <span>{sortIndicator('soldQuantity')}</span>
                        </button>
                      </th>
                      <th aria-sort={productSort.key === 'grossSalesYen' ? productSort.direction : 'none'}>
                        <button className="sort-button" type="button" onClick={() => updateProductSort('grossSalesYen')}>
                          粗売上 <span>{sortIndicator('grossSalesYen')}</span>
                        </button>
                      </th>
                      <th aria-sort={productSort.key === 'discountAmountYen' ? productSort.direction : 'none'}>
                        <button className="sort-button" type="button" onClick={() => updateProductSort('discountAmountYen')}>
                          値引額 <span>{sortIndicator('discountAmountYen')}</span>
                        </button>
                      </th>
                      <th aria-sort={productSort.key === 'netSalesYen' ? productSort.direction : 'none'}>
                        <button className="sort-button" type="button" onClick={() => updateProductSort('netSalesYen')}>
                          純売上 <span>{sortIndicator('netSalesYen')}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProductSummary.map((product) => (
                      <tr key={product.productId}>
                        <td>
                          <a
                            className="product-link"
                            href={buildHashHref(product.productId, startDate, endDate)}
                          >
                            {product.canonicalName}
                          </a>
                        </td>
                        <td>{integer.format(product.soldQuantity)}</td>
                        <td>{yen.format(product.grossSalesYen)}</td>
                        <td>{yen.format(product.discountAmountYen)}</td>
                        <td><strong>{yen.format(product.netSalesYen)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
          )
        )}
      </main>
    </div>
  )
}
