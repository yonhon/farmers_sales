import { useEffect, useMemo, useState } from 'react'

import {
  hashSalesSource,
  normalizeProductName,
  parseSalesText,
} from '../lib/salesImport'
import { supabase } from '../lib/supabase'
import type { ParseSalesResult, ParsedSalesLine } from '../lib/salesImport'

const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})
const integer = new Intl.NumberFormat('ja-JP')

type ProductRow = {
  product_id: string
  canonical_name: string
}

type ProductAliasRow = {
  product_id: string
  raw_product_name: string
  normalized_product_name: string
}

type ProductResolution = {
  mode: '' | 'existing' | 'new'
  productId: string
  canonicalName: string
}

type ImportResult = {
  status: 'imported' | 'already_imported'
  import_batch_id: string
  inserted_reports: number
  inserted_lines: number
  skipped_reports: number
}

type SalesImportProps = {
  appRole: string
  onImported: (firstDate: string, lastDate: string) => void
}

function makeYearOptions() {
  const currentYear = new Date().getFullYear()
  const lastYear = Math.max(2028, currentYear + 2)
  return Array.from({ length: lastYear - 2026 + 1 }, (_, index) => 2026 + index)
}

export function SalesImport({ appRole, onImported }: SalesImportProps) {
  const years = useMemo(makeYearOptions, [])
  const currentYear = new Date().getFullYear()
  const [reportYear, setReportYear] = useState(
    years.includes(currentYear) ? currentYear : years[0],
  )
  const [sourceText, setSourceText] = useState('')
  const [parseResult, setParseResult] = useState<ParseSalesResult | null>(null)
  const [products, setProducts] = useState<ProductRow[]>([])
  const [aliases, setAliases] = useState<ProductAliasRow[]>([])
  const [resolutions, setResolutions] = useState<Record<string, ProductResolution>>({})
  const [existingDates, setExistingDates] = useState<Set<string>>(new Set())
  const [isLoadingMaster, setIsLoadingMaster] = useState(true)
  const [isChecking, setIsChecking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    let active = true

    async function loadMaster() {
      setIsLoadingMaster(true)
      try {
        if (!supabase) return
        const [productResponse, aliasResponse] = await Promise.all([
          supabase
            .from('products')
            .select('product_id, canonical_name')
            .eq('is_active', true)
            .order('canonical_name'),
          supabase
            .from('product_aliases')
            .select('product_id, raw_product_name, normalized_product_name')
            .eq('review_status', 'confirmed'),
        ])
        if (productResponse.error) throw productResponse.error
        if (aliasResponse.error) throw aliasResponse.error
        if (!active) return
        setProducts((productResponse.data ?? []) as ProductRow[])
        setAliases((aliasResponse.data ?? []) as ProductAliasRow[])
      } catch (error) {
        if (!active) return
        console.error(error)
        setErrorMessage('商品マスターを取得できませんでした。')
      } finally {
        if (active) setIsLoadingMaster(false)
      }
    }

    void loadMaster()
    return () => {
      active = false
    }
  }, [])

  const aliasesByRawName = useMemo(
    () => new Map(aliases.map((alias) => [alias.raw_product_name, alias.product_id])),
    [aliases],
  )
  const aliasesByNormalizedName = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const alias of aliases) {
      const current = map.get(alias.normalized_product_name)
      map.set(
        alias.normalized_product_name,
        current === undefined || current === alias.product_id ? alias.product_id : null,
      )
    }
    return map
  }, [aliases])
  function findKnownProductId(line: ParsedSalesLine) {
    return aliasesByRawName.get(line.raw_product_name)
      ?? aliasesByNormalizedName.get(line.normalized_product_name)
      ?? null
  }

  const unknownProductNames = useMemo(() => {
    if (!parseResult) return []
    const names = new Map<string, string>()
    for (const report of parseResult.reports) {
      for (const line of report.lines) {
        if (!findKnownProductId(line)) {
          names.set(line.raw_product_name, line.normalized_product_name)
        }
      }
    }
    return [...names].map(([rawName, normalizedName]) => ({ rawName, normalizedName }))
  // The alias maps are stable inputs to this derived list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliasesByNormalizedName, aliasesByRawName, parseResult])

  const resolutionsComplete = unknownProductNames.every(({ rawName }) => {
    const resolution = resolutions[rawName]
    return resolution?.mode === 'existing'
      ? Boolean(resolution.productId)
      : resolution?.mode === 'new' && Boolean(resolution.canonicalName.trim())
  })

  function resetParsedState() {
    setParseResult(null)
    setResolutions({})
    setExistingDates(new Set())
    setImportResult(null)
    setErrorMessage('')
  }

  async function checkContent() {
    setIsChecking(true)
    setErrorMessage('')
    setImportResult(null)
    try {
      const result = parseSalesText(sourceText, reportYear)
      setParseResult(result)
      setResolutions({})
      setExistingDates(new Set())

      if (result.reports.length && supabase) {
        const dates = result.reports.map((report) => report.report_date)
        const { data, error } = await supabase
          .from('sales_reports')
          .select('report_date')
          .eq('status', 'confirmed')
          .in('report_date', dates)
        if (error) throw error
        setExistingDates(new Set((data ?? []).map((row) => String(row.report_date))))
      }
    } catch (error) {
      console.error(error)
      setErrorMessage('貼り付け内容の確認中にエラーが発生しました。')
    } finally {
      setIsChecking(false)
    }
  }

  function setResolution(rawName: string, value: string) {
    if (!value) {
      setResolutions((current) => ({
        ...current,
        [rawName]: { mode: '', productId: '', canonicalName: '' },
      }))
      return
    }
    if (value === '__new__') {
      const normalizedName = unknownProductNames.find((item) => item.rawName === rawName)?.normalizedName ?? rawName
      setResolutions((current) => ({
        ...current,
        [rawName]: {
          mode: 'new',
          productId: '',
          canonicalName: normalizeProductName(normalizedName),
        },
      }))
      return
    }
    setResolutions((current) => ({
      ...current,
      [rawName]: { mode: 'existing', productId: value, canonicalName: '' },
    }))
  }

  async function importReports() {
    if (!parseResult?.isValid || !resolutionsComplete || !supabase) return
    setIsSaving(true)
    setErrorMessage('')
    setImportResult(null)
    try {
      const sourceHash = await hashSalesSource(reportYear, sourceText)
      const reports = parseResult.reports.map((report) => ({
        report_date: report.report_date,
        report_time: report.report_time,
        sender_name: report.sender_name,
        recipient_name: report.recipient_name,
        market_name: report.market_name,
        reported_sold_quantity: report.reported_sold_quantity,
        reported_net_sales_yen: report.reported_net_sales_yen,
        source_start_line: report.source_start_line,
        lines: report.lines.map((line) => {
          const knownProductId = findKnownProductId(line)
          const resolution = resolutions[line.raw_product_name]
          return {
            ...line,
            product_id: knownProductId
              ?? (resolution?.mode === 'existing' ? resolution.productId : null),
            new_canonical_name:
              resolution?.mode === 'new' ? resolution.canonicalName.trim() : null,
          }
        }),
      }))

      const { data, error } = await supabase.rpc('import_sales_blocks', {
        p_report_year: reportYear,
        p_source_sha256: sourceHash,
        p_reports: reports,
      })
      if (error) throw error
      const result = data as ImportResult
      setImportResult(result)

      const dates = parseResult.reports.map((report) => report.report_date).sort()
      onImported(dates[0], dates[dates.length - 1])
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(`登録できませんでした：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const canImport = Boolean(
    parseResult?.isValid
      && resolutionsComplete
      && (appRole === 'admin' || appRole === 'inputter')
      && !isSaving,
  )

  return (
    <div className="sales-import">
      <section className="panel import-entry-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">PASTE SALES REPORTS</p>
            <h2>売上状況を貼り付け</h2>
          </div>
          <span className="record-count">年をまたぐ一括登録はできません</span>
        </div>

        <label className="year-select">
          対象年
          <select
            value={reportYear}
            onChange={(event) => {
              setReportYear(Number(event.target.value))
              resetParsedState()
            }}
          >
            {years.map((year) => <option key={year} value={year}>{year}年</option>)}
          </select>
        </label>

        <label className="paste-field">
          売上状況
          <textarea
            value={sourceText}
            rows={18}
            placeholder={'08/24 18:30 売上状況\n県立農業大学校様\n《やんばる市場》\n…'}
            onChange={(event) => {
              setSourceText(event.target.value)
              resetParsedState()
            }}
          />
        </label>

        <button
          className="primary-button import-action"
          type="button"
          disabled={!sourceText.trim() || isChecking || isLoadingMaster}
          onClick={() => void checkContent()}
        >
          {isChecking ? '内容を確認しています…' : '内容を確認'}
        </button>
      </section>

      {errorMessage && <div className="status-panel error" role="alert">{errorMessage}</div>}

      {parseResult && (
        <>
          <section className="metric-grid import-summary" aria-label="取り込み内容の集計">
            <article className="metric-card accent">
              <p>販売報告</p>
              <strong>{integer.format(parseResult.reportCount)}日分</strong>
              <span>{reportYear}年として登録</span>
            </article>
            <article className="metric-card">
              <p>商品明細</p>
              <strong>{integer.format(parseResult.lineCount)}件</strong>
              <span>商品・単価ごとの行数</span>
            </article>
            <article className="metric-card">
              <p>販売個数</p>
              <strong>{integer.format(parseResult.soldQuantity)}</strong>
              <span>全報告の合計</span>
            </article>
            <article className="metric-card">
              <p>純売上</p>
              <strong>{yen.format(parseResult.netSalesYen)}</strong>
              <span>全報告の合計</span>
            </article>
          </section>

          {parseResult.issues.length > 0 && (
            <section className="panel issue-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">VALIDATION</p>
                  <h2>確認事項</h2>
                </div>
              </div>
              <ul className="issue-list">
                {parseResult.issues.map((item, index) => (
                  <li className={item.severity} key={`${item.code}-${index}`}>
                    <strong>{item.severity === 'error' ? 'エラー' : '警告'}</strong>
                    {item.reportDate && <span>{item.reportDate}</span>}
                    <span>{item.message}</span>
                    {item.sourceLineNumber && <small>{item.sourceLineNumber}行目</small>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unknownProductNames.length > 0 && (
            <section className="panel resolution-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">PRODUCT RESOLUTION</p>
                  <h2>未登録商品の確認</h2>
                </div>
                <span className="record-count">{unknownProductNames.length}商品</span>
              </div>
              {appRole !== 'admin' && (
                <p className="form-error">未登録商品の対応付けは管理者のみ行えます。</p>
              )}
              <div className="resolution-list">
                {unknownProductNames.map(({ rawName, normalizedName }) => {
                  const resolution = resolutions[rawName]
                  const value = resolution?.mode === 'new'
                    ? '__new__'
                    : resolution?.mode === 'existing'
                      ? resolution.productId
                      : ''
                  return (
                    <div className="resolution-row" key={rawName}>
                      <div>
                        <strong>{rawName}</strong>
                        <span>正規化：{normalizedName}</span>
                      </div>
                      <select
                        aria-label={`${rawName}の対応先`}
                        value={value}
                        disabled={appRole !== 'admin'}
                        onChange={(event) => setResolution(rawName, event.target.value)}
                      >
                        <option value="">対応先を選択</option>
                        {products.map((product) => (
                          <option key={product.product_id} value={product.product_id}>
                            既存：{product.canonical_name}
                          </option>
                        ))}
                        <option value="__new__">新しい商品として登録</option>
                      </select>
                      {resolution?.mode === 'new' && (
                        <input
                          aria-label={`${rawName}の正式商品名`}
                          value={resolution.canonicalName}
                          onChange={(event) => setResolutions((current) => ({
                            ...current,
                            [rawName]: { ...current[rawName], canonicalName: event.target.value },
                          }))}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">IMPORT PREVIEW</p>
                <h2>日別の確認</h2>
              </div>
              <span className={`validation-badge ${parseResult.isValid ? 'valid' : 'invalid'}`}>
                {parseResult.isValid ? '合計一致' : '要修正'}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>明細数</th>
                    <th>販売個数</th>
                    <th>純売上</th>
                    <th>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.reports.map((report) => (
                    <tr key={report.report_date}>
                      <td>{report.report_date}</td>
                      <td>{integer.format(report.lines.length)}</td>
                      <td>{integer.format(report.calculated_sold_quantity)}</td>
                      <td>{yen.format(report.calculated_net_sales_yen)}</td>
                      <td>
                        {existingDates.has(report.report_date)
                          ? '登録済み・内容照合'
                          : report.isValid ? '正常' : 'エラー'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="import-commit-panel">
            <div>
              <strong>{parseResult.reportCount}日分を一括登録します</strong>
              <span>途中で失敗した場合は、全件が取り消されます。</span>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!canImport}
              onClick={() => void importReports()}
            >
              {isSaving ? '一括登録しています…' : 'Supabaseへ一括登録'}
            </button>
          </section>
        </>
      )}

      {importResult && (
        <section className="status-panel success" role="status">
          <h2>{importResult.status === 'already_imported' ? '登録済みのデータです' : '登録が完了しました'}</h2>
          <p>
            新規報告 {importResult.inserted_reports}件、明細 {importResult.inserted_lines}件、
            登録済みスキップ {importResult.skipped_reports}件
          </p>
          {parseResult && (
            <a
              className="primary-button result-link"
              href={`#/?from=${parseResult.reports.map((report) => report.report_date).sort()[0]}&to=${parseResult.reports.map((report) => report.report_date).sort().at(-1)}`}
            >
              登録期間をダッシュボードで確認
            </a>
          )}
        </section>
      )}
    </div>
  )
}
