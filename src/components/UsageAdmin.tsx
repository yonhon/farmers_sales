import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO, subDays, subMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { findTopUsageUsers } from '../lib/usageTracking'
import { supabase } from '../lib/supabase'

type DailyMetric = {
  day_jst: string
  pv: number
  uu: number
  action_count: number
  error_count: number
}

type MonthlyMetric = {
  month_jst: string
  pv: number
  uu: number
  action_count: number
  error_count: number
}

type DailyUserPv = {
  day_jst: string
  user_id: string | null
  display_name: string
  pv: number
}

type MonthlyUserPv = {
  month_jst: string
  user_id: string | null
  display_name: string
  pv: number
}

type UserSummary = {
  user_id: string
  display_name: string
  app_role: 'viewer' | 'inputter' | 'admin'
  account_status: 'active' | 'suspended'
  last_seen_at: string | null
  pv_7d: number
  pv_30d: number
  actions_30d: number
  errors_30d: number
}

type LatestError = {
  error_code: string
  message_summary: string
  page_path: string
  count_7d: number
  last_seen_at: string
}

type UsageEventRow = {
  event_id: number
  event_at: string
  user_id: string | null
  display_name_snapshot: string
  event_type: 'page_view' | 'action' | 'error'
  event_origin: 'client' | 'server' | 'legacy'
  page_path: string
  action_name: string | null
  target_type: string | null
  target_id: string | null
  outcome: 'success' | 'failure' | null
  error_code: string | null
  message_summary: string | null
}

const integer = new Intl.NumberFormat('ja-JP')
const chartColors = ['#c97932', '#497a5d', '#745c9e', '#b55252', '#547c9d']
const historyPageSize = 25

function asNumber<T extends object>(rows: T[], keys: string[]) {
  return rows.map((row) => {
    const normalized = { ...row } as Record<string, unknown>
    for (const key of keys) normalized[key] = Number(normalized[key] ?? 0)
    return normalized as T
  })
}

function formatJst(value: string | null) {
  if (!value) return '利用記録なし'
  return format(new Date(value), 'yyyy/MM/dd HH:mm', { locale: ja })
}

function eventLabel(eventType: UsageEventRow['event_type']) {
  if (eventType === 'page_view') return '画面閲覧'
  if (eventType === 'action') return '操作'
  return 'エラー'
}

function originLabel(origin: UsageEventRow['event_origin']) {
  if (origin === 'server') return 'DB監査'
  if (origin === 'client') return 'クライアント'
  return '移行前'
}

function buildTrendRows<T extends { user_id: string | null; pv: number }>(
  metrics: Array<Record<string, unknown>>,
  userRows: T[],
  dateKey: string,
  topUsers: ReturnType<typeof findTopUsageUsers>,
) {
  return metrics.map((metric) => {
    const result = { ...metric }
    for (const [index, user] of topUsers.entries()) {
      result[`user_${index}`] = userRows
        .filter((row) => row.user_id === user.userId && String((row as Record<string, unknown>)[dateKey]) === String(metric[dateKey]))
        .reduce((sum, row) => sum + Number(row.pv), 0)
    }
    return result
  })
}

export function UsageAdmin() {
  const [days, setDays] = useState<30 | 90>(30)
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([])
  const [monthlyMetrics, setMonthlyMetrics] = useState<MonthlyMetric[]>([])
  const [dailyUserPv, setDailyUserPv] = useState<DailyUserPv[]>([])
  const [monthlyUserPv, setMonthlyUserPv] = useState<MonthlyUserPv[]>([])
  const [userSummaries, setUserSummaries] = useState<UserSummary[]>([])
  const [latestErrors, setLatestErrors] = useState<LatestError[]>([])
  const [history, setHistory] = useState<UsageEventRow[]>([])
  const [historyCount, setHistoryCount] = useState(0)
  const [userFilter, setUserFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [originFilter, setOriginFilter] = useState('')
  const [historyPage, setHistoryPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return null

    const dailyFrom = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')
    const monthlyFrom = format(subMonths(new Date(), 11), 'yyyy-MM-01')
    let historyQuery = supabase
      .from('usage_events')
      .select(
        'event_id, event_at, user_id, display_name_snapshot, event_type, event_origin, page_path, action_name, target_type, target_id, outcome, error_code, message_summary',
        { count: 'exact' },
      )
      .gte('event_at', subDays(new Date(), days).toISOString())
      .order('event_at', { ascending: false })
      .range(historyPage * historyPageSize, (historyPage + 1) * historyPageSize - 1)

    if (userFilter) historyQuery = historyQuery.eq('user_id', userFilter)
    if (eventFilter) historyQuery = historyQuery.eq('event_type', eventFilter)
    if (originFilter) historyQuery = historyQuery.eq('event_origin', originFilter)

    const [daily, monthly, dailyUsers, monthlyUsers, users, errors, events] = await Promise.all([
      supabase.schema('analytics').from('usage_daily_metrics_jst')
        .select('day_jst, pv, uu, action_count, error_count').gte('day_jst', dailyFrom).order('day_jst'),
      supabase.schema('analytics').from('usage_monthly_metrics_jst')
        .select('month_jst, pv, uu, action_count, error_count').gte('month_jst', monthlyFrom).order('month_jst'),
      supabase.schema('analytics').from('usage_daily_user_pv_jst')
        .select('day_jst, user_id, display_name, pv').gte('day_jst', dailyFrom).order('day_jst'),
      supabase.schema('analytics').from('usage_monthly_user_pv_jst')
        .select('month_jst, user_id, display_name, pv').gte('month_jst', monthlyFrom).order('month_jst'),
      supabase.schema('analytics').from('usage_user_summary')
        .select('user_id, display_name, app_role, account_status, last_seen_at, pv_7d, pv_30d, actions_30d, errors_30d')
        .order('last_seen_at', { ascending: false, nullsFirst: false }),
      supabase.schema('analytics').from('usage_error_latest_7d_jst')
        .select('error_code, message_summary, page_path, count_7d, last_seen_at')
        .order('count_7d', { ascending: false }).limit(10),
      historyQuery,
    ])

    const failed = [daily, monthly, dailyUsers, monthlyUsers, users, errors, events].find((response) => response.error)
    if (failed?.error) throw failed.error

    return {
      dailyMetrics: asNumber((daily.data ?? []) as DailyMetric[], ['pv', 'uu', 'action_count', 'error_count']),
      monthlyMetrics: asNumber((monthly.data ?? []) as MonthlyMetric[], ['pv', 'uu', 'action_count', 'error_count']),
      dailyUserPv: asNumber((dailyUsers.data ?? []) as DailyUserPv[], ['pv']),
      monthlyUserPv: asNumber((monthlyUsers.data ?? []) as MonthlyUserPv[], ['pv']),
      userSummaries: asNumber((users.data ?? []) as UserSummary[], ['pv_7d', 'pv_30d', 'actions_30d', 'errors_30d']),
      latestErrors: asNumber((errors.data ?? []) as LatestError[], ['count_7d']),
      history: (events.data ?? []) as UsageEventRow[],
      historyCount: events.count ?? 0,
    }
  }, [days, eventFilter, historyPage, originFilter, reloadKey, userFilter])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setErrorMessage('')
    void load()
      .then((result) => {
        if (!active || !result) return
        setDailyMetrics(result.dailyMetrics)
        setMonthlyMetrics(result.monthlyMetrics)
        setDailyUserPv(result.dailyUserPv)
        setMonthlyUserPv(result.monthlyUserPv)
        setUserSummaries(result.userSummaries)
        setLatestErrors(result.latestErrors)
        setHistory(result.history)
        setHistoryCount(result.historyCount)
        setLoadedAt(new Date())
      })
      .catch((error) => {
        if (!active) return
        console.error(error)
        setErrorMessage('利用状況を取得できませんでした。管理者権限とanalyticsスキーマの公開設定を確認してください。')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [load])

  const topDailyUsers = useMemo(() => findTopUsageUsers(dailyUserPv), [dailyUserPv])
  const topMonthlyUsers = useMemo(() => findTopUsageUsers(monthlyUserPv), [monthlyUserPv])
  const dailyTrend = useMemo(
    () => buildTrendRows(dailyMetrics, dailyUserPv, 'day_jst', topDailyUsers),
    [dailyMetrics, dailyUserPv, topDailyUsers],
  )
  const monthlyTrend = useMemo(
    () => buildTrendRows(monthlyMetrics, monthlyUserPv, 'month_jst', topMonthlyUsers),
    [monthlyMetrics, monthlyUserPv, topMonthlyUsers],
  )
  const summary = useMemo(() => ({
    pv: dailyMetrics.reduce((sum, row) => sum + row.pv, 0),
    uu: new Set(dailyUserPv.map((row) => row.user_id).filter(Boolean)).size,
    actions: dailyMetrics.reduce((sum, row) => sum + row.action_count, 0),
    errors: dailyMetrics.reduce((sum, row) => sum + row.error_count, 0),
  }), [dailyMetrics, dailyUserPv])
  const pageCount = Math.max(1, Math.ceil(historyCount / historyPageSize))

  return (
    <div className="usage-admin">
      <section className="admin-page-heading">
        <div>
          <p className="eyebrow">USAGE MONITORING</p>
          <h1>利用状況</h1>
          <p className="muted">ユーザーの利用傾向、操作履歴、エラー発生状況を確認できます。</p>
        </div>
        <div className="usage-toolbar">
          <div className="period-switch" role="group" aria-label="日次・履歴期間">
            {[30, 90].map((value) => (
              <button
                key={value}
                className={days === value ? 'is-active' : ''}
                type="button"
                onClick={() => { setDays(value as 30 | 90); setHistoryPage(0) }}
              >
                {value}日
              </button>
            ))}
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setReloadKey((value) => value + 1)}>
            更新
          </button>
          {loadedAt && <span className="usage-updated">最終更新 {format(loadedAt, 'HH:mm')}</span>}
        </div>
      </section>

      {isLoading && <div className="status-panel">利用状況を読み込んでいます…</div>}
      {errorMessage && <div className="status-panel error" role="alert">{errorMessage}</div>}

      {!isLoading && !errorMessage && (
        <>
          <section className="metric-grid usage-metrics" aria-label={`${days}日間の利用サマリー`}>
            <article className="metric-card accent"><p>ユニークユーザー</p><strong>{integer.format(summary.uu)}</strong><span>期間内UU</span></article>
            <article className="metric-card"><p>ページビュー</p><strong>{integer.format(summary.pv)}</strong><span>管理画面自身を除外</span></article>
            <article className="metric-card"><p>業務操作</p><strong>{integer.format(summary.actions)}</strong><span>登録・権限変更など</span></article>
            <article className="metric-card"><p>エラー</p><strong>{integer.format(summary.errors)}</strong><span>クライアントエラー</span></article>
          </section>

          <section className="usage-chart-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="section-kicker">DAILY TREND</p><h2>日次 UU / PV / 上位5ユーザーPV</h2></div></div>
              <div className="chart-wrap usage-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyTrend} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#dfe4da" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="day_jst" tickFormatter={(value) => format(parseISO(String(value)), 'M/d')} minTickGap={20} />
                    <YAxis allowDecimals={false} />
                    <Tooltip labelFormatter={(value) => format(parseISO(String(value)), 'yyyy年M月d日', { locale: ja })} />
                    <Legend />
                    <Bar dataKey="pv" name="PV" fill="#d29345" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="uu" name="UU" stroke="#183c2d" strokeWidth={2.5} />
                    {topDailyUsers.map((user, index) => (
                      <Line key={user.userId} type="monotone" dataKey={`user_${index}`} name={user.displayName} stroke={chartColors[index]} dot={false} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading"><div><p className="section-kicker">MONTHLY TREND</p><h2>月次 UU / PV / 上位5ユーザーPV</h2></div></div>
              <div className="chart-wrap usage-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTrend} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#dfe4da" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="month_jst" tickFormatter={(value) => format(parseISO(String(value)), 'yyyy/M')} minTickGap={20} />
                    <YAxis allowDecimals={false} />
                    <Tooltip labelFormatter={(value) => format(parseISO(String(value)), 'yyyy年M月', { locale: ja })} />
                    <Legend />
                    <Bar dataKey="pv" name="PV" fill="#d29345" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="uu" name="UU" stroke="#183c2d" strokeWidth={2.5} />
                    {topMonthlyUsers.map((user, index) => (
                      <Line key={user.userId} type="monotone" dataKey={`user_${index}`} name={user.displayName} stroke={chartColors[index]} dot={false} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="usage-chart-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="section-kicker">ERROR TREND</p><h2>エラー件数（日次）</h2></div></div>
              <div className="chart-wrap compact">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyMetrics}>
                    <CartesianGrid stroke="#dfe4da" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="day_jst" tickFormatter={(value) => format(parseISO(String(value)), 'M/d')} minTickGap={20} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="error_count" name="エラー" fill="#b55252" radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel table-panel">
              <div className="panel-heading"><div><p className="section-kicker">LATEST ERRORS</p><h2>最新エラー上位（直近7日）</h2></div></div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>コード</th><th>要約</th><th>画面</th><th>件数</th><th>最終発生</th></tr></thead>
                  <tbody>
                    {latestErrors.map((error) => (
                      <tr key={`${error.error_code}-${error.message_summary}-${error.page_path}`}>
                        <td><code>{error.error_code}</code></td><td>{error.message_summary}</td><td>{error.page_path}</td>
                        <td>{integer.format(error.count_7d)}</td><td>{formatJst(error.last_seen_at)}</td>
                      </tr>
                    ))}
                    {!latestErrors.length && <tr><td colSpan={5} className="empty-cell">直近7日間のエラーはありません。</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <section className="panel table-panel">
            <div className="panel-heading"><div><p className="section-kicker">USER SUMMARY</p><h2>ユーザー別利用状況</h2></div></div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>ユーザー</th><th>権限</th><th>状態</th><th>最終利用</th><th>PV（7日）</th><th>PV（30日）</th><th>操作（30日）</th><th>エラー（30日）</th></tr></thead>
                <tbody>{userSummaries.map((user) => (
                  <tr key={user.user_id}>
                    <td><button className="table-filter-button" type="button" onClick={() => { setUserFilter(user.user_id); setHistoryPage(0) }}>{user.display_name}</button></td>
                    <td>{user.app_role}</td><td>{user.account_status === 'active' ? '有効' : '利用停止'}</td><td>{formatJst(user.last_seen_at)}</td>
                    <td>{integer.format(user.pv_7d)}</td><td>{integer.format(user.pv_30d)}</td><td>{integer.format(user.actions_30d)}</td><td>{integer.format(user.errors_30d)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className="panel table-panel">
            <div className="panel-heading usage-history-heading">
              <div><p className="section-kicker">ACTIVITY HISTORY</p><h2>操作履歴</h2></div>
              <div className="history-filters">
                <label>ユーザー<select value={userFilter} onChange={(event) => { setUserFilter(event.target.value); setHistoryPage(0) }}><option value="">すべて</option>{userSummaries.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name}</option>)}</select></label>
                <label>種別<select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setHistoryPage(0) }}><option value="">すべて</option><option value="page_view">画面閲覧</option><option value="action">操作</option><option value="error">エラー</option></select></label>
                <label>記録元<select value={originFilter} onChange={(event) => { setOriginFilter(event.target.value); setHistoryPage(0) }}><option value="">すべて</option><option value="server">DB監査</option><option value="client">クライアント</option><option value="legacy">移行前</option></select></label>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>日時</th><th>ユーザー</th><th>種別</th><th>記録元</th><th>画面</th><th>操作・エラー</th><th>対象</th><th>結果</th></tr></thead>
                <tbody>
                  {history.map((event) => (
                    <tr key={event.event_id}>
                      <td>{formatJst(event.event_at)}</td><td>{event.display_name_snapshot}</td><td>{eventLabel(event.event_type)}</td><td><span className={`origin-badge ${event.event_origin}`}>{originLabel(event.event_origin)}</span></td><td>{event.page_path}</td>
                      <td>{event.action_name ?? event.error_code ?? '—'}{event.message_summary ? <small className="history-message">{event.message_summary}</small> : null}</td>
                      <td>{event.target_type ? `${event.target_type}${event.target_id ? `: ${event.target_id}` : ''}` : '—'}</td>
                      <td>{event.outcome === 'success' ? '成功' : event.outcome === 'failure' ? '失敗' : '—'}</td>
                    </tr>
                  ))}
                  {!history.length && <tr><td colSpan={8} className="empty-cell">条件に一致する履歴はありません。</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="history-pagination">
              <span>{integer.format(historyCount)}件中 {historyCount ? historyPage * historyPageSize + 1 : 0}–{Math.min((historyPage + 1) * historyPageSize, historyCount)}件</span>
              <div><button className="secondary-button compact" type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => page - 1)}>前へ</button><span>{historyPage + 1} / {pageCount}</span><button className="secondary-button compact" type="button" disabled={historyPage + 1 >= pageCount} onClick={() => setHistoryPage((page) => page + 1)}>次へ</button></div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
