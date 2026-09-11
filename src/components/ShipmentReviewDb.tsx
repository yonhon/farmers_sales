import { useEffect, useMemo, useRef, useState } from 'react'

import {
  ShipmentReviewApiError,
  actionableShipmentReviewCandidates,
  canFinalizeShipmentReview,
  createShipmentReviewRequestId,
  getShipmentReviewApi,
  isShipmentReviewCandidate,
} from '../lib/shipmentReviewClient'
import type {
  ShipmentReviewAction,
  ShipmentReviewBatch,
  ShipmentReviewBatchSummary,
  ShipmentReviewDbRow,
  ShipmentReviewField,
  ShipmentReviewObservation,
  ShipmentReviewRowStatus,
} from '../lib/shipmentReviewClient'
import { sourcePageNumber } from '../lib/shipmentReview'

const selectedBatchStorageKey = 'shipment-review:selected-batch:v2'

const statusLabels: Record<ShipmentReviewRowStatus, string> = {
  unreviewed: '未確認',
  in_review: '確認中',
  approved: '承認済み',
  deferred: '保留',
  no_shipment: '出荷なし',
  rejected: '差し戻し',
}

const fieldDefinitions: Array<{
  key: ShipmentReviewField
  label: string
  inputMode?: 'numeric' | 'text'
}> = [
  { key: 'product', label: '品目名' },
  { key: 'content_value', label: '内容量', inputMode: 'numeric' },
  { key: 'content_unit', label: '単位' },
  { key: 'unit_price_yen', label: '単価（円）', inputMode: 'numeric' },
  { key: 'shipment_package_quantity', label: '数量', inputMode: 'numeric' },
]

type Draft = Record<ShipmentReviewField, string>
type OperationState = {
  kind: 'idle' | 'saving' | 'success' | 'error'
  message: string
  retryable: boolean
}

function compareRows(left: ShipmentReviewDbRow, right: ShipmentReviewDbRow) {
  return (sourcePageNumber(left.source_page) ?? Number.MAX_SAFE_INTEGER)
    - (sourcePageNumber(right.source_page) ?? Number.MAX_SAFE_INTEGER)
    || left.source_row - right.source_row
    || left.shipment_review_row_id.localeCompare(right.shipment_review_row_id)
}

function displayedObservation(row: ShipmentReviewDbRow, field: ShipmentReviewField) {
  const observations = row.observations.filter((item) => item.field_name === field)
  return observations.find((item) => item.review_status === 'accepted')
    ?? observations.find((item) => item.review_status === 'proposed' && !isShipmentReviewCandidate(item))
    ?? observations.find((item) => item.review_status === 'proposed')
    ?? null
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

function issueTitle(code: string, fieldName: string | null, severity: string) {
  const fieldLabel = fieldDefinitions.find(({ key }) => key === fieldName)?.label
  if (code === 'transcription_review_note') return '転記内容の確認'
  if (code.startsWith('missing_')) return `${fieldLabel ?? '必須項目'}が未入力`
  if (severity === 'error') return `${fieldLabel ?? '入力内容'}の修正が必要`
  if (severity === 'warning') return `${fieldLabel ?? '入力内容'}の確認が必要`
  return `${fieldLabel ?? '転記内容'}の参考情報`
}

function sourceRowTopPercent(sourceRow: number) {
  return Math.min(89.4, 19.2 + Math.max(0, sourceRow) * 1.8)
}

function detectPopulatedShipmentRows(image: HTMLImageElement, expectedCount: number) {
  const physicalRowCount = 40
  if (expectedCount <= 0 || expectedCount >= physicalRowCount) {
    return Array.from({ length: Math.min(expectedCount, physicalRowCount) }, (_, index) => index)
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.min(360, image.naturalWidth)
  canvas.height = Math.round(image.naturalHeight * canvas.width / image.naturalWidth)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return Array.from({ length: expectedCount }, (_, index) => index)

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const rowStep = canvas.height * 0.018
  const firstCenter = canvas.height * 0.192
  const sampleRanges = [[0.19, 0.25], [0.28, 0.34], [0.37, 0.43], [0.46, 0.51], [0.54, 0.60]]
  const scores = Array.from({ length: physicalRowCount }, (_, physicalRow) => {
    const center = firstCenter + physicalRow * rowStep
    const top = Math.max(0, Math.round(center - rowStep * 0.3))
    const bottom = Math.min(canvas.height - 1, Math.round(center + rowStep * 0.3))
    let ink = 0
    let samples = 0
    for (const [from, to] of sampleRanges) {
      for (let x = Math.round(canvas.width * from); x <= Math.round(canvas.width * to); x += 2) {
        for (let y = top; y <= bottom; y += 2) {
          const offset = (y * canvas.width + x) * 4
          const luminance = (pixels[offset] * 299 + pixels[offset + 1] * 587 + pixels[offset + 2] * 114) / 1000
          ink += Math.max(0, 175 - luminance)
          samples += 1
        }
      }
    }
    return { physicalRow, score: samples ? ink / samples : 0 }
  })

  return scores
    .sort((left, right) => right.score - left.score)
    .slice(0, expectedCount)
    .map(({ physicalRow }) => physicalRow)
    .sort((left, right) => left - right)
}

function draftFor(row: ShipmentReviewDbRow): Draft {
  return Object.fromEntries(fieldDefinitions.map(({ key }) => [
    key,
    valueText(displayedObservation(row, key)?.normalized_value),
  ])) as Draft
}

function normalizedValue(field: ShipmentReviewField, value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (field === 'content_value' || field === 'unit_price_yen' || field === 'shipment_package_quantity') {
    const number = Number(trimmed)
    if (!Number.isFinite(number)) throw new Error('数値項目には有効な数値を入力してください。')
    return number
  }
  return trimmed
}

function quoteCsv(value: unknown) {
  const text = valueText(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadAuditCsv(rows: ShipmentReviewDbRow[]) {
  const header = [
    'source_page', 'source_row', 'row_status', 'shipment_date', 'market_code',
    ...fieldDefinitions.map((field) => field.key),
    'destination', 'open_issue_count', 'action_count', 'linked_shipment_line_id',
  ]
  const records = rows.map((row) => [
    row.source_page,
    row.source_row,
    row.row_status,
    row.shipment_date,
    row.market_code,
    ...fieldDefinitions.map((field) => displayedObservation(row, field.key)?.normalized_value),
    row.destination,
    row.issues.filter((issue) => issue.issue_status === 'open').length,
    row.actions.length,
    row.linked_shipment_line_id,
  ])
  const blob = new Blob([
    '\uFEFF',
    [header, ...records].map((record) => record.map(quoteCsv).join(',')).join('\r\n') + '\r\n',
  ], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'shipment_review_audit.csv'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function errorState(error: unknown): OperationState {
  if (error instanceof ShipmentReviewApiError) {
    return { kind: 'error', message: error.message, retryable: error.retryable }
  }
  return {
    kind: 'error',
    message: error instanceof Error ? error.message : '処理に失敗しました。',
    retryable: false,
  }
}

export function ShipmentReviewDb() {
  const [batches, setBatches] = useState<ShipmentReviewBatchSummary[]>([])
  const [batch, setBatch] = useState<ShipmentReviewBatch | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [imagePhysicalRows, setImagePhysicalRows] = useState<Record<string, number[]>>({})
  const [bundleName, setBundleName] = useState('')
  const [zoom, setZoom] = useState(100)
  const [operation, setOperation] = useState<OperationState>({ kind: 'idle', message: '', retryable: false })
  const imageScrollRef = useRef<HTMLDivElement>(null)
  const sourceImageRef = useRef<HTMLImageElement>(null)

  const rows = useMemo(() => [...(batch?.rows ?? [])].sort(compareRows), [batch])
  const currentRow = rows[currentIndex] ?? null

  useEffect(() => {
    let active = true
    async function loadInitialState() {
      setOperation({ kind: 'saving', message: '未完了バッチを読み込んでいます…', retryable: false })
      try {
        const api = getShipmentReviewApi()
        const nextBatches = await api.listBatches()
        if (!active) return
        setBatches(nextBatches)
        const cached = window.localStorage.getItem(selectedBatchStorageKey)
        const selected = nextBatches.find((item) => item.import_batch_id === cached)
          ?? nextBatches.find((item) => !item.finalized_at)
        if (selected) {
          const detail = await api.getBatch(selected.import_batch_id)
          if (!active) return
          setBatch(detail)
        }
        setOperation({ kind: 'idle', message: '', retryable: false })
      } catch (error) {
        if (active) setOperation(errorState(error))
      }
    }
    void loadInitialState()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!currentRow) {
      setDraft(null)
      return
    }
    setDraft(draftFor(currentRow))
    setDecisionReason(currentRow.comment ?? '')
  }, [currentRow])

  useEffect(() => () => {
    Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url))
  }, [imageUrls])

  const counts = useMemo(() => {
    const result: Record<ShipmentReviewRowStatus, number> = {
      unreviewed: 0,
      in_review: 0,
      approved: 0,
      deferred: 0,
      no_shipment: 0,
      rejected: 0,
    }
    rows.forEach((row) => { result[row.row_status] += 1 })
    return result
  }, [rows])

  const pages = useMemo(
    () => [...new Set(rows.map((row) => row.source_page))]
      .sort((left, right) => (sourcePageNumber(left) ?? 999) - (sourcePageNumber(right) ?? 999)),
    [rows],
  )
  const pageRows = currentRow
    ? rows.map((row, index) => ({ row, index })).filter(({ row }) => row.source_page === currentRow.source_page)
    : []
  const currentPageRowPosition = pageRows.findIndex(({ index }) => index === currentIndex)
  const openIssues = currentRow?.issues.filter((issue) => issue.issue_status === 'open') ?? []
  const candidates = currentRow ? actionableShipmentReviewCandidates(currentRow) : []
  const openErrorCount = openIssues.filter((issue) => issue.severity === 'error').length
  const openWarningCount = openIssues.filter((issue) => issue.severity === 'warning').length
  const openInfoCount = openIssues.filter((issue) => issue.severity === 'info').length
  const isBusy = operation.kind === 'saving'
  const canFinalize = Boolean(batch)
    && !batch?.finalized_at
    && canFinalizeShipmentReview(rows)
    && rows.some((row) => row.row_status === 'approved')
    && rows.every((row) => row.row_status === 'approved' || row.row_status === 'no_shipment')
  const pageImageUrl = currentRow ? imageUrls[currentRow.source_page] : undefined
  const currentPhysicalRow = currentRow && currentPageRowPosition >= 0
    ? imagePhysicalRows[currentRow.source_page]?.[currentPageRowPosition] ?? currentRow.source_row
    : 0
  const currentRowTop = sourceRowTopPercent(currentPhysicalRow)

  function focusCurrentImageRow(smooth: boolean) {
    const scroller = imageScrollRef.current
    const image = sourceImageRef.current
    if (!scroller || !image || !image.clientHeight) return
    const target = image.offsetTop + image.clientHeight * currentRowTop / 100 - scroller.clientHeight * 0.32
    scroller.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
  }

  function analyzeImageRowsAfterPaint(image: HTMLImageElement, sourcePage: string, expectedCount: number) {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        try {
          const detectedRows = detectPopulatedShipmentRows(image, expectedCount)
          setImagePhysicalRows((current) => ({ ...current, [sourcePage]: detectedRows }))
        } catch {
          setImagePhysicalRows((current) => ({
            ...current,
            [sourcePage]: Array.from({ length: expectedCount }, (_, index) => index),
          }))
        }
      }, 0)
    })
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => focusCurrentImageRow(true))
    return () => window.cancelAnimationFrame(frame)
  }, [currentRow?.shipment_review_row_id, currentRowTop, pageImageUrl, zoom])

  async function refreshBatch(importBatchId: string, preferredRowId?: string) {
    const api = getShipmentReviewApi()
    const [detail, nextBatches] = await Promise.all([
      api.getBatch(importBatchId),
      api.listBatches(),
    ])
    setBatch(detail)
    setBatches(nextBatches)
    window.localStorage.setItem(selectedBatchStorageKey, importBatchId)
    if (preferredRowId) {
      const nextRows = [...detail.rows].sort(compareRows)
      const nextIndex = nextRows.findIndex((row) => row.shipment_review_row_id === preferredRowId)
      if (nextIndex >= 0) setCurrentIndex(nextIndex)
    }
  }

  async function selectBatch(importBatchId: string) {
    setOperation({ kind: 'saving', message: 'バッチを読み込んでいます…', retryable: false })
    try {
      await refreshBatch(importBatchId)
      setCurrentIndex(0)
      setOperation({ kind: 'success', message: 'DBの最新状態を読み込みました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function importBundle(file: File | undefined) {
    if (!file) return
    setBundleName(file.name)
    setOperation({ kind: 'saving', message: 'レビューbundleを登録しています…', retryable: false })
    try {
      const bundleValue: unknown = JSON.parse(await file.text())
      const result = await getShipmentReviewApi().importBundle(bundleValue)
      await refreshBatch(result.import_batch_id)
      setCurrentIndex(0)
      setOperation({
        kind: 'success',
        message: result.created ? 'レビューbundleを登録しました。' : '登録済みbundleを再読み込みしました。',
        retryable: false,
      })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  function loadImages(files: FileList | null) {
    if (!files) return
    const next: Record<string, string> = {}
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) next[file.name] = URL.createObjectURL(file)
    })
    setImagePhysicalRows({})
    setImageUrls(next)
  }

  async function apply(action: Omit<ShipmentReviewAction, 'request_id'>) {
    return getShipmentReviewApi().applyAction({ ...action, request_id: createShipmentReviewRequestId() })
  }

  async function prepareRow(row: ShipmentReviewDbRow) {
    if (row.row_status === 'unreviewed') {
      await apply({
        shipment_review_row_id: row.shipment_review_row_id,
        expected_row_status: 'unreviewed',
        action_type: 'start_review',
      })
    } else if (row.row_status !== 'in_review') {
      await apply({
        shipment_review_row_id: row.shipment_review_row_id,
        expected_row_status: row.row_status,
        action_type: 'return_to_review',
      })
    }
  }

  async function confirmFields() {
    if (!currentRow || !draft || !batch) return
    setOperation({ kind: 'saving', message: '入力値を監査履歴へ保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      for (const { key } of fieldDefinitions) {
        const previous = displayedObservation(currentRow, key)
        await apply({
          shipment_review_row_id: currentRow.shipment_review_row_id,
          expected_row_status: 'in_review',
          action_type: 'correct_value',
          field_name: key,
          raw_value: previous?.raw_value ?? draft[key],
          normalized_value: normalizedValue(key, draft[key]),
          confidence: 'high',
          evidence: { source: 'shipment_review_ui', confirmation: true },
        })
      }
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: '5項目を確定し、操作履歴へ保存しました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function actOnCandidate(observation: ShipmentReviewObservation, accepted: boolean) {
    if (!currentRow || !batch) return
    setOperation({ kind: 'saving', message: '候補の判断を保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: accepted ? 'accept_candidate' : 'reject_candidate',
        observation_id: observation.shipment_field_observation_id,
        notes: accepted ? '画面で候補を採用' : '画面で候補を却下',
      })
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: `候補を${accepted ? '採用' : '却下'}しました。`, retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function closeIssue(issueId: string, severity: 'info' | 'warning' | 'error') {
    if (!currentRow || !batch) return
    setOperation({ kind: 'saving', message: '警告の処理結果を保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: severity === 'error' ? 'resolve_issue' : 'accept_issue',
        issue_id: issueId,
        notes: severity === 'error' ? '入力値を確認・修正して解決' : '内容を確認して許容',
      })
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: '警告の処理結果を保存しました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function decide(actionType: 'approve' | 'defer' | 'mark_no_shipment' | 'reject_row') {
    if (!currentRow || !batch) return
    if (actionType !== 'approve' && !decisionReason.trim()) {
      setOperation({ kind: 'error', message: 'この判断には理由を入力してください。', retryable: false })
      return
    }
    setOperation({ kind: 'saving', message: '行の判断を保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: actionType,
        notes: decisionReason.trim() || undefined,
      })
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: '行の判断をDBへ保存しました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function finalizeBatch() {
    if (!batch) return
    setOperation({ kind: 'saving', message: '承認済みデータを本番へ反映しています…', retryable: false })
    try {
      await getShipmentReviewApi().finalize(batch.import_batch_id)
      await refreshBatch(batch.import_batch_id, currentRow?.shipment_review_row_id)
      setOperation({ kind: 'success', message: '本番反映が完了しました。再実行しても重複しません。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  function selectPage(sourcePage: string) {
    const first = rows.findIndex((row) => row.source_page === sourcePage)
    if (first >= 0) setCurrentIndex(first)
  }

  return (
    <div className="shipment-review">
      <section className="panel shipment-review-setup">
        <div>
          <p className="section-kicker">DATABASE REVIEW</p>
          <h2>レビューbundleを登録・再開</h2>
          <p className="muted">bundleと確認結果はSupabaseへ保存します。原画像はブラウザ内だけで扱います。</p>
        </div>
        <div className="shipment-file-inputs">
          <label className="file-picker">
            <span>レビューbundle</span>
            <input type="file" accept=".json,application/json" disabled={isBusy} onChange={(event) => void importBundle(event.target.files?.[0])} />
            <small>{bundleName || 'shipment_review_bundle.jsonを選択'}</small>
          </label>
          <label className="file-picker">
            <span>原画像（ローカルのみ）</span>
            <input type="file" accept="image/*" multiple onChange={(event) => loadImages(event.target.files)} />
            <small>{Object.keys(imageUrls).length ? `${Object.keys(imageUrls).length}枚を読込済み` : '同じ月の画像をまとめて選択'}</small>
          </label>
          <label className="file-picker">
            <span>DB上のバッチ</span>
            <select value={batch?.import_batch_id ?? ''} disabled={isBusy} onChange={(event) => void selectBatch(event.target.value)}>
              <option value="">選択してください</option>
              {batches.map((item) => (
                <option key={item.import_batch_id} value={item.import_batch_id}>
                  {item.source_month.slice(0, 7)} v{item.report_version}・{item.pending_count ? `未完了${item.pending_count}行` : item.finalized_at ? '反映済み' : '判断済み'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {operation.kind !== 'idle' && (
        <div className={`status-panel${operation.kind === 'error' ? ' error' : ''}`} role={operation.kind === 'error' ? 'alert' : 'status'}>
          {operation.message}{operation.kind === 'error' && operation.retryable ? ' DBの最新状態を取得して再試行できます。' : ''}
          {operation.kind === 'error' && operation.retryable && batch && (
            <button className="text-button" type="button" onClick={() => void selectBatch(batch.import_batch_id)}>最新状態を再読込</button>
          )}
        </div>
      )}

      {batch && currentRow && draft ? (
        <>
          <section className="review-progress" aria-label="確認状況">
            <div><strong>{rows.length}</strong><span>全行</span></div>
            <div className="pending"><strong>{counts.unreviewed + counts.in_review}</strong><span>未完了</span></div>
            <div className="approved"><strong>{counts.approved}</strong><span>承認済み</span></div>
            <div className="held"><strong>{counts.deferred}</strong><span>保留</span></div>
            <div className="excluded"><strong>{counts.no_shipment}</strong><span>出荷なし</span></div>
            <div className="review-progress-note"><p>v{batch.report_version} / {batch.source_month.slice(0, 7)}</p><small>DBを正本として保存</small></div>
          </section>

          <div className="review-page-bar">
            <nav className="review-page-tabs" aria-label="原稿ページ">
              {pages.map((page) => {
                const pending = rows.filter((row) => row.source_page === page && ['unreviewed', 'in_review'].includes(row.row_status)).length
                const number = sourcePageNumber(page)
                return <button className={page === currentRow.source_page ? 'is-active' : ''} type="button" key={page} onClick={() => selectPage(page)}>
                  {number ? `${String(number).padStart(2, '0')}ページ` : page}<small>{pending ? `未完了 ${pending}` : '判断済み'}</small>
                </button>
              })}
            </nav>
            <div className={`review-batch-actions${canFinalize ? ' ready' : ''}`}>
              <span>{batch.finalized_at ? '本番反映済み' : canFinalize ? '反映準備完了' : '全行判断後に反映'}</span>
              <button className="secondary-button compact" type="button" disabled={isBusy} onClick={() => downloadAuditCsv(rows)}>監査CSV</button>
              <button className="primary-button compact" type="button" disabled={!canFinalize || isBusy} onClick={() => void finalizeBatch()}>本番反映</button>
            </div>
          </div>

          <div className="shipment-review-workspace">
            <section className="panel source-image-panel">
              <div className="panel-heading"><div><p className="section-kicker">SOURCE IMAGE</p><h2>{currentRow.source_page}</h2></div>
                <label className="image-zoom">表示倍率 {zoom}%<input type="range" min="60" max="180" step="10" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              </div>
              <div className="source-image-scroll" ref={imageScrollRef}>
                {pageImageUrl ? <><div className="source-image-stage" style={{ width: `${zoom}%` }}><img ref={sourceImageRef} src={pageImageUrl} alt={`${currentRow.source_page}の原画像`} onLoad={(event) => { analyzeImageRowsAfterPaint(event.currentTarget, currentRow.source_page, pageRows.length); focusCurrentImageRow(false) }} /><span className="source-row-highlight" style={{ top: `${currentRowTop}%` }} aria-hidden="true" /></div><div className="source-image-scroll-spacer" aria-hidden="true" /></>
                  : <div className="image-placeholder"><strong>このページの画像が選択されていません</strong><span>画像はSupabaseへ送信されません。</span></div>}
              </div>
            </section>

            <section className="panel review-editor-panel">
              <header className="review-editor-header">
                <div className="review-row-heading"><div><p className="section-kicker">ROW {currentRow.source_row}</p><h2>{draft.product || '品目名未入力'}</h2></div>
                  <span className={`review-status ${currentRow.row_status}`}>{statusLabels[currentRow.row_status]}</span>
                </div>
                <div className="review-row-toolbar">
                  <button className="text-link-button" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>前の行</button>
                  <strong>{currentIndex + 1} / {rows.length}</strong>
                  <span className={`review-warning-status${openErrorCount + openWarningCount ? ' needs-review' : ''}`}>{openErrorCount + openWarningCount ? `要確認 ${openErrorCount + openWarningCount}` : '警告なし'}</span>
                  <button className="text-link-button" type="button" disabled={currentIndex === rows.length - 1} onClick={() => setCurrentIndex((index) => Math.min(rows.length - 1, index + 1))}>次の行</button>
                </div>
              </header>
              <div className="review-editor-scroll">
                <details className="review-row-picker"><summary>このページの行を選択（{pageRows.length}行）</summary><div className="review-row-nav" aria-label="このページの行">{pageRows.map(({ row, index }) => <button className={`${index === currentIndex ? 'is-current' : ''} ${row.row_status}`} type="button" key={row.shipment_review_row_id} onClick={() => setCurrentIndex(index)}>{row.source_row}{row.issues.some((issue) => issue.issue_status === 'open' && issue.severity !== 'info') && <span aria-label="警告あり">!</span>}</button>)}</div></details>

                <dl className="raw-observation"><div><dt>出荷日</dt><dd>{currentRow.shipment_date}</dd></div><div><dt>市場</dt><dd>{currentRow.market_code}</dd></div><div><dt>原記載の備考</dt><dd>{currentRow.raw_notes || '—'}</dd></div></dl>

                <div className="review-fields">{fieldDefinitions.map((field) => {
                  const fieldCandidates = candidates.filter((candidate) => candidate.field_name === field.key)
                  const inputId = `shipment-review-${field.key}`
                  return <div className={`review-field${field.key === 'product' || fieldCandidates.length > 3 ? ' wide' : ''}`} key={field.key}>
                    <label htmlFor={inputId}>{field.label}</label>
                    <input id={inputId} type="text" inputMode={field.inputMode} value={draft[field.key]} disabled={isBusy || Boolean(batch.finalized_at)} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
                    {fieldCandidates.length > 0 && <div className="review-field-candidates" aria-label={`${field.label}の修正候補`}><span>候補をクリックして採用</span>{fieldCandidates.map((candidate) => <div className="review-candidate-chip" key={candidate.shipment_field_observation_id}><button type="button" className="review-candidate-value" disabled={isBusy} title={`採用（確度: ${candidate.confidence}）`} onClick={() => void actOnCandidate(candidate, true)}>{valueText(candidate.normalized_value)}を採用</button><button type="button" className="review-candidate-reject" disabled={isBusy} aria-label={`${field.label}候補 ${valueText(candidate.normalized_value)} を却下`} title="候補を却下" onClick={() => void actOnCandidate(candidate, false)}>却下</button></div>)}</div>}
                  </div>
                })}</div>

                {openIssues.length > 0 && <details className="review-issues" key={currentRow.shipment_review_row_id} open={openErrorCount > 0}><summary><strong>警告・確認事項</strong><span>{openErrorCount > 0 && `エラー ${openErrorCount}件`}{openErrorCount > 0 && openWarningCount > 0 && '・'}{openWarningCount > 0 && `警告 ${openWarningCount}件`}{(openErrorCount > 0 || openWarningCount > 0) && openInfoCount > 0 && '・'}{openInfoCount > 0 && `情報 ${openInfoCount}件`}</span></summary><p className="review-issue-guidance">入力値を保存した後、該当する警告を解決してください。</p><div className="review-db-list">{openIssues.map((issue) => <div className={`review-db-item ${issue.severity}`} key={issue.shipment_review_issue_id}><div><strong>{issueTitle(issue.code, issue.field_name, issue.severity)}</strong><details className="review-issue-technical"><summary>詳細</summary><code>{issue.code}</code><span>{issue.message}</span></details></div><button type="button" className="secondary-button compact" disabled={isBusy} onClick={() => void closeIssue(issue.shipment_review_issue_id, issue.severity)}>{issue.severity === 'error' ? '修正済みとして解決' : '確認して許容'}</button></div>)}</div></details>}

                <details className="review-history"><summary>操作履歴（{currentRow.actions.length}件）</summary>{currentRow.actions.length ? <ol>{currentRow.actions.map((action) => <li key={action.shipment_review_action_id}><time>{new Date(action.acted_at).toLocaleString('ja-JP')}</time> {action.action_type}{action.notes ? ` — ${action.notes}` : ''}</li>)}</ol> : <p>操作履歴はまだありません。</p>}</details>
                <div className="review-action-dock">
                  <label className="review-decision-reason">判断理由・コメント<input type="text" value={decisionReason} disabled={isBusy || Boolean(batch.finalized_at)} onChange={(event) => setDecisionReason(event.target.value)} placeholder="保留・出荷なし・差し戻しでは必須" /></label>
                  <div className="review-action-buttons"><button className="secondary-button review-confirm-fields" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void confirmFields()}>入力を保存</button><button className="primary-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('approve')}>承認</button><button className="secondary-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('defer')}>保留</button><button className="danger-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('mark_no_shipment')}>出荷なし</button><button className="text-link-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('reject_row')}>差し戻し</button></div>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : !isBusy && operation.kind !== 'error' ? (
        <section className="shipment-review-empty"><span aria-hidden="true">照</span><h2>bundleを登録するか、DB上のバッチを選択してください</h2><p>前回の進捗はDBから復元されます。</p></section>
      ) : null}
    </div>
  )
}
