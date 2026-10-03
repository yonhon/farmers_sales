import { useEffect, useMemo, useRef, useState } from 'react'

import {
  ShipmentReviewApiError,
  actionableShipmentReviewCandidates,
  canFinalizeShipmentReview,
  createShipmentReviewRequestId,
  getShipmentReviewApi,
  initialShipmentReviewObservation,
  isCarriedOverShipmentReviewRow,
  primaryShipmentReviewObservation,
  shipmentReviewDecisionAdvances,
} from '../lib/shipmentReviewClient'
import type {
  ShipmentCorrectionDiffResult,
  ShipmentReviewAction,
  ShipmentReviewBatch,
  ShipmentReviewBatchSummary,
  ShipmentReviewDbRow,
  ShipmentReviewField,
  ShipmentReviewObservation,
  ShipmentReviewIssue,
  ShipmentReviewRowStatus,
  TaxAdjustedSalesMatch,
  TaxAdjustedSalesReference,
} from '../lib/shipmentReviewClient'
import {
  correctionDiffState,
  correctionFieldLabel,
  formatCorrectionLine,
  formatCorrectionSource,
  formatCorrectionValue,
} from '../lib/shipmentCorrection'
import {
  groupMarkdownMatches,
  markdownLabel,
  splitPartPosition,
} from '../lib/shipmentMarkdown'
import type { MarkdownSalesReference } from '../lib/shipmentMarkdown'
import { completeShipmentContentUnit, sourcePageNumber } from '../lib/shipmentReview'
import { shipmentReviewPhysicalRow } from '../lib/shipmentReviewImageRows'
import { mergeSourceImageUrls } from '../lib/shipmentReviewImages'
import {
  serializeShipmentReviewSnapshot,
  shipmentReviewSnapshotFilename,
} from '../lib/shipmentReviewSnapshot'

const selectedBatchStorageKey = 'shipment-review:selected-batch:v2'

const statusLabels: Record<ShipmentReviewRowStatus, string> = {
  unreviewed: '未確認',
  in_review: '確認中',
  approved: '承認済み',
  deferred: '保留',
  // Displayed as a general "withdraw this row from the current production import" outcome, not only
  // "there was no real shipment": e.g. a discounted (おつとめ品) sale the price-match logic can't yet
  // verify is also withdrawn this way, so the batch can still finalize. The row_status value and DB
  // schema are unchanged.
  no_shipment: '登録取下',
  rejected: '差し戻し',
}

const fieldDefinitions: Array<{
  key: ShipmentReviewField
  label: string
  inputMode?: 'numeric' | 'text'
  // Optional fields are not part of the five required review values (ADR007 sticker price).
  optional?: boolean
}> = [
  { key: 'product', label: '品目名' },
  { key: 'content_value', label: '内容量', inputMode: 'numeric' },
  { key: 'content_unit', label: '単位' },
  { key: 'unit_price_yen', label: '単価（円）', inputMode: 'numeric' },
  { key: 'shipment_package_quantity', label: '数量', inputMode: 'numeric' },
  { key: 'markdown_unit_price_yen', label: 'シール価格（値引分のみ）', inputMode: 'numeric', optional: true },
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
    || (left.source_part ?? 0) - (right.source_part ?? 0)
    || left.shipment_review_row_id.localeCompare(right.shipment_review_row_id)
}

function displayedObservation(row: ShipmentReviewDbRow, field: ShipmentReviewField) {
  return primaryShipmentReviewObservation(row, field)
}

function isIntentionallyMissing(observation: ShipmentReviewObservation | null) {
  return Boolean(
    observation
    && observation.normalized_value == null
    && observation.value_source === 'human_corrected'
    && observation.evidence.intentional_missing === true,
  )
}

// Groups tax-adjusted sales matches by price so a price sold on several dates within the window shows
// as one adoptable button, not one per date.
function dedupeTaxAdjustedMatches(matches: TaxAdjustedSalesMatch[]) {
  const groups = new Map<number, { sales_unit_price_yen: number; dates: string[]; totalQuantity: number; matches: TaxAdjustedSalesMatch[] }>()
  matches.forEach((match) => {
    const group = groups.get(match.sales_unit_price_yen) ?? {
      sales_unit_price_yen: match.sales_unit_price_yen,
      dates: [],
      totalQuantity: 0,
      matches: [],
    }
    group.dates.push(match.report_date)
    group.totalQuantity += match.sold_quantity
    group.matches.push(match)
    groups.set(match.sales_unit_price_yen, group)
  })
  return [...groups.values()].sort((left, right) => left.sales_unit_price_yen - right.sales_unit_price_yen)
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

// Kept in sync with public.apply_shipment_review_action (202610030004): these issues can only be
// closed by a correction (or accepted candidate, or the tax-adjusted adopt-sales-price button) that
// makes the row's product and price actually match sales data — never by accepting or otherwise
// closing the mismatch as-is. A row that cannot be made to match is withdrawn (登録取下) instead.
const SALES_MATCH_REQUIRED_ISSUE_CODES = new Set([
  'price_not_observed_in_sales_window',
  'tax_adjusted_price_match_candidate',
  'possible_product_misread',
  // ADR007: a sticker price that matches a discounted sale, and a sticker row left without a slot.
  'markdown_price_match_candidate',
  'markdown_discount_slot_unavailable',
])

// Price issues for which a markdown sticker may explain the ledger price (ADR007).
const MARKDOWN_REFERENCE_ISSUE_CODES = new Set([
  'price_not_observed_in_sales_window',
  'markdown_price_match_candidate',
  'markdown_discount_slot_unavailable',
])

function issueTitle(code: string, fieldName: string | null, severity: string) {
  const fieldLabel = fieldDefinitions.find(({ key }) => key === fieldName)?.label
  if (code === 'transcription_review_note') return '転記内容の確認'
  if (code === 'markdown_price_match_candidate') return '値引シールの価格の可能性'
  if (code === 'markdown_discount_slot_unavailable') return '対応する値引販売の枠が残っていません'
  if (code.startsWith('missing_')) return `${fieldLabel ?? '必須項目'}が未入力`
  if (severity === 'error') return `${fieldLabel ?? '入力内容'}の修正が必要`
  if (severity === 'warning') return `${fieldLabel ?? '入力内容'}の確認が必要`
  return `${fieldLabel ?? '転記内容'}の参考情報`
}

function sourceRowTopPercent(sourceRow: number) {
  return Math.min(89.4, 19.2 + Math.max(0, sourceRow) * 1.8)
}

function draftFor(row: ShipmentReviewDbRow): Draft {
  const unitObservation = displayedObservation(row, 'content_unit')
  const preserveMissingUnit = isIntentionallyMissing(unitObservation)
  const next = Object.fromEntries(fieldDefinitions.map(({ key }) => [
    key,
    valueText(displayedObservation(row, key)?.normalized_value),
  ])) as Draft
  next.content_unit = completeShipmentContentUnit(
    next.content_unit,
    next.content_value,
    next.product,
    preserveMissingUnit,
  )
  return next
}

// What the pre-input (LLM) originally read for a field, shown beside the label so it stays visible
// after the box is overwritten. An empty reading is shown as 空欄.
function initialValueText(row: ShipmentReviewDbRow, field: ShipmentReviewField) {
  const observation = initialShipmentReviewObservation(row, field)
  return valueText(observation?.normalized_value ?? observation?.raw_value).trim() || '空欄'
}

function draftDiffersFromInitial(row: ShipmentReviewDbRow, field: ShipmentReviewField, draftValue: string) {
  const observation = initialShipmentReviewObservation(row, field)
  try {
    return !normalizedValuesEqual(field, observation?.normalized_value, draftValue)
  } catch {
    return true
  }
}

function normalizedValue(field: ShipmentReviewField, value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (field === 'content_value' || field === 'unit_price_yen' || field === 'shipment_package_quantity'
    || field === 'markdown_unit_price_yen') {
    const number = Number(trimmed)
    if (!Number.isFinite(number)) throw new Error('数値項目には有効な数値を入力してください。')
    return number
  }
  return trimmed
}

function normalizedValuesEqual(field: ShipmentReviewField, stored: unknown, draftValue: string) {
  const next = normalizedValue(field, draftValue)
  if (stored === null || stored === undefined || next === null) {
    return (stored === null || stored === undefined) && next === null
  }
  if (field === 'content_value' || field === 'unit_price_yen' || field === 'shipment_package_quantity'
    || field === 'markdown_unit_price_yen') {
    return Number(stored) === next
  }
  return String(stored).trim() === next
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

function downloadAuditSnapshot(batch: ShipmentReviewBatch) {
  const blob = new Blob(
    [serializeShipmentReviewSnapshot(batch)],
    { type: 'application/json;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = shipmentReviewSnapshotFilename(batch)
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
  const [preserveMissingUnit, setPreserveMissingUnit] = useState(false)
  const [decisionReason, setDecisionReason] = useState('')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [bundleName, setBundleName] = useState('')
  const [zoom, setZoom] = useState(100)
  const [operation, setOperation] = useState<OperationState>({ kind: 'idle', message: '', retryable: false })
  const [taxAdjustedReference, setTaxAdjustedReference] = useState<TaxAdjustedSalesReference | null>(null)
  const [taxAdjustedReferenceError, setTaxAdjustedReferenceError] = useState(false)
  const [correctionDiff, setCorrectionDiff] = useState<ShipmentCorrectionDiffResult | null>(null)
  const [correctionDiffError, setCorrectionDiffError] = useState(false)
  const [markdownReference, setMarkdownReference] = useState<MarkdownSalesReference | null>(null)
  const [markdownReferenceError, setMarkdownReferenceError] = useState(false)
  const imageScrollRef = useRef<HTMLDivElement>(null)
  const sourceImageRef = useRef<HTMLImageElement>(null)
  const rowRailRef = useRef<HTMLDivElement>(null)
  const imageUrlsRef = useRef<Record<string, string>>({})

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
      setPreserveMissingUnit(false)
      return
    }
    const unitObservation = displayedObservation(currentRow, 'content_unit')
    setPreserveMissingUnit(isIntentionallyMissing(unitObservation))
    setDraft(draftFor(currentRow))
    setDecisionReason(currentRow.comment ?? '')
  }, [currentRow])

  // Object URLs are released only when the screen closes. Releasing them whenever the set changes would
  // break the images kept from an earlier selection.
  useEffect(() => () => {
    Object.values(imageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    const rail = rowRailRef.current
    const current = rail?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!rail || !current) return
    if (current.offsetTop < rail.scrollTop) rail.scrollTop = Math.max(0, current.offsetTop - 8)
    else if (current.offsetTop + current.offsetHeight > rail.scrollTop + rail.clientHeight) {
      rail.scrollTop = current.offsetTop + current.offsetHeight - rail.clientHeight + 8
    }
  }, [currentIndex, currentRow?.source_page])

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
  const openIssues = currentRow?.issues.filter((issue) => issue.issue_status === 'open') ?? []
  const candidates = currentRow ? actionableShipmentReviewCandidates(currentRow) : []
  const openErrorCount = openIssues.filter((issue) => issue.severity === 'error').length
  const openWarningCount = openIssues.filter((issue) => issue.severity === 'warning').length
  const openInfoCount = openIssues.filter((issue) => issue.severity === 'info').length
  const currentMarkdownPrice = currentRow
    ? valueText(displayedObservation(currentRow, 'markdown_unit_price_yen')?.normalized_value).trim()
    : ''
  const currentListPrice = currentRow
    ? valueText(displayedObservation(currentRow, 'unit_price_yen')?.normalized_value).trim()
    : ''
  const currentMarkdownLabel = currentMarkdownPrice ? markdownLabel(currentListPrice, currentMarkdownPrice) : null
  const currentSplitPosition = currentRow ? splitPartPosition(currentRow, rows) : null
  const markdownReferenceIssue = openIssues.find((issue) => MARKDOWN_REFERENCE_ISSUE_CODES.has(issue.code)) ?? null
  const showMarkdownReference = Boolean(markdownReferenceIssue || currentMarkdownPrice)
  const openTaxAdjustedPriceIssue = openIssues.find((issue) => (
    issue.code === 'tax_adjusted_price_match_candidate' && issue.field_name === 'unit_price_yen'
  )) ?? null
  const isBusy = operation.kind === 'saving'
  const isCorrectionBatch = batch?.batch_kind === 'correction'
  const correctionState = correctionDiffState(correctionDiff)
  const currentRowIsCarried = currentRow ? isCarriedOverShipmentReviewRow(currentRow) : false
  const canFinalize = Boolean(batch)
    && !batch?.finalized_at
    && canFinalizeShipmentReview(rows)
    && rows.some((row) => row.row_status === 'approved')
    && rows.every((row) => row.row_status === 'approved' || row.row_status === 'no_shipment')
    // ADR008: a correction is finalized only after a person approved exactly the current diff.
    && (!isCorrectionBatch || correctionState.approvalCurrent)
  const pageImageUrl = currentRow ? imageUrls[currentRow.source_page] : undefined
  const currentPhysicalRow = currentRow
    ? shipmentReviewPhysicalRow(currentRow.source_page, currentRow.source_row)
    : 0
  const currentRowTop = sourceRowTopPercent(currentPhysicalRow)
  const currentStoredProduct = currentRow
    ? valueText(displayedObservation(currentRow, 'product')?.normalized_value).trim()
    : ''
  const bulkProductCorrectionRows = currentStoredProduct && draft?.product.trim()
    && currentStoredProduct !== draft.product.trim()
    ? rows.filter((row) => (
        valueText(displayedObservation(row, 'product')?.normalized_value).trim() === currentStoredProduct
        && row.row_status !== 'no_shipment'
        // Carried-over rows are production lines; each change needs its own reason.
        && !isCarriedOverShipmentReviewRow(row)
      ))
    : []

  // Live evidence for an open tax-adjusted price match: the sales-side price is not stored in the
  // review bundle, so it is fetched on demand instead of being derived from the row's own data.
  useEffect(() => {
    setTaxAdjustedReference(null)
    setTaxAdjustedReferenceError(false)
    if (!openTaxAdjustedPriceIssue || !currentRow) return
    let active = true
    getShipmentReviewApi().taxAdjustedSalesReference(currentRow.shipment_review_row_id)
      .then((reference) => { if (active) setTaxAdjustedReference(reference) })
      .catch(() => { if (active) setTaxAdjustedReferenceError(true) })
    return () => { active = false }
  }, [openTaxAdjustedPriceIssue?.shipment_review_issue_id, currentRow])

  // Discounted sales a sticker price may correspond to, fetched like the tax-adjusted reference.
  useEffect(() => {
    setMarkdownReference(null)
    setMarkdownReferenceError(false)
    if (!showMarkdownReference || !currentRow) return
    let active = true
    getShipmentReviewApi().markdownSalesReference(currentRow.shipment_review_row_id)
      .then((reference) => { if (active) setMarkdownReference(reference) })
      .catch(() => { if (active) setMarkdownReferenceError(true) })
    return () => { active = false }
  }, [showMarkdownReference, currentRow])

  // The diff is recomputed by the database from the current rows, so it is reloaded whenever the batch
  // detail is refreshed after an action.
  useEffect(() => {
    setCorrectionDiff(null)
    setCorrectionDiffError(false)
    if (!batch || batch.batch_kind !== 'correction') return
    let active = true
    getShipmentReviewApi().getCorrectionDiff(batch.import_batch_id)
      .then((result) => { if (active) setCorrectionDiff(result) })
      .catch(() => { if (active) setCorrectionDiffError(true) })
    return () => { active = false }
  }, [batch])

  function focusCurrentImageRow(smooth: boolean) {
    const scroller = imageScrollRef.current
    const image = sourceImageRef.current
    if (!scroller || !image || !image.clientHeight) return
    const target = image.offsetTop + image.clientHeight * currentRowTop / 100 - scroller.clientHeight * 0.32
    scroller.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
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
    return detail
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
    const { urls, added } = mergeSourceImageUrls(
      imageUrlsRef.current,
      Array.from(files),
      (file) => URL.createObjectURL(file),
      (url) => URL.revokeObjectURL(url),
    )
    if (!added) return
    imageUrlsRef.current = urls
    setImageUrls(urls)
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
        notes: isCarriedOverShipmentReviewRow(row) ? decisionReason.trim() || undefined : undefined,
      })
    }
  }

  // Carried-over rows are copies of production lines: returning one to review, re-approving it, or
  // withdrawing it needs a reason (public.apply_shipment_review_action, ADR008).
  function carriedRowReasonMissing(row: ShipmentReviewDbRow) {
    if (!isCarriedOverShipmentReviewRow(row) || decisionReason.trim()) return false
    setOperation({
      kind: 'error',
      message: '前版から引き継いだ行（本番の明細）を変更するには、判断理由を入力してください。',
      retryable: false,
    })
    return true
  }

  function inferMissingDraftUnit(value: Draft): Draft {
    return {
      ...value,
      content_unit: completeShipmentContentUnit(
        value.content_unit,
        value.content_value,
        value.product,
        preserveMissingUnit,
      ),
    }
  }

  function updateDraftField(field: ShipmentReviewField, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current)
    if (field === 'content_unit') setPreserveMissingUnit(!value.trim())
  }

  async function persistDraftValues(row: ShipmentReviewDbRow, value: Draft, rowIsPrepared = false) {
    if (!rowIsPrepared) await prepareRow(row)
    for (const { key } of fieldDefinitions) {
      const previous = displayedObservation(row, key)
      const nextValue = normalizedValue(key, value[key])
      if (previous?.review_status === 'accepted'
        && normalizedValuesEqual(key, previous.normalized_value, value[key])) continue
      if (key === 'markdown_unit_price_yen' && nextValue === null
        && (previous?.normalized_value === null || previous?.normalized_value === undefined)) continue
      await apply({
        shipment_review_row_id: row.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: 'correct_value',
        field_name: key,
        raw_value: previous?.raw_value ?? value[key],
        normalized_value: nextValue,
        confidence: 'high',
        evidence: {
          source: 'shipment_review_ui',
          confirmation: true,
          intentional_missing: nextValue === null,
        },
      })
    }
  }

  async function confirmFields() {
    if (!currentRow || !draft || !batch) return
    if (carriedRowReasonMissing(currentRow)) return
    setOperation({ kind: 'saving', message: '入力値を監査履歴へ保存しています…', retryable: false })
    try {
      const completedDraft = inferMissingDraftUnit(draft)
      setDraft(completedDraft)
      await persistDraftValues(currentRow, completedDraft)
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: '5項目を確定し、操作履歴へ保存しました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function actOnCandidate(observation: ShipmentReviewObservation, accepted: boolean) {
    if (!currentRow || !batch) return
    if (carriedRowReasonMissing(currentRow)) return
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

  // Writes the sales-side (tax-included) price verbatim into unit_price_yen. Writing the raw sales
  // price, rather than a tax-exclusive figure rounded from it, sidesteps the floor/ceiling rounding
  // question entirely: the exact-match check that other saves rely on then simply succeeds against the
  // real sales_line, and app_private.revalidate_shipment_review_price_issue_after_action (202609230005)
  // resolves tax_adjusted_price_match_candidate on that same match — there is no separate accept/resolve
  // step to call here, and public.apply_shipment_review_action now rejects one for this issue anyway.
  async function adoptTaxAdjustedSalesPrice(match: TaxAdjustedSalesMatch) {
    if (!currentRow || !batch || !draft || !openTaxAdjustedPriceIssue) return
    if (carriedRowReasonMissing(currentRow)) return
    const issueId = openTaxAdjustedPriceIssue.shipment_review_issue_id
    const nextDraft = { ...draft, unit_price_yen: String(match.sales_unit_price_yen) }
    setDraft(nextDraft)
    setOperation({ kind: 'saving', message: '販売実績の税込単価を出荷単価として保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      await persistDraftValues(currentRow, nextDraft, true)
      const detail = await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      const refreshedRow = detail.rows.find((row) => row.shipment_review_row_id === currentRow.shipment_review_row_id)
      const stillOpen = refreshedRow?.issues.some((item) => (
        item.shipment_review_issue_id === issueId && item.issue_status === 'open'
      ))
      setOperation(stillOpen
        ? { kind: 'error', message: '単価は保存しましたが、この販売実績とは一致しませんでした。値をご確認ください。', retryable: false }
        : { kind: 'success', message: '単価を販売実績の税込価格に更新し、警告を解消しました。', retryable: false })
    } catch (error) {
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id).catch(() => {})
      setOperation(errorState(error))
    }
  }

  // ADR007: the ledger shows the sticker price; POS sold at the list price with a discount. Adopting
  // stores the sale's list price as unit_price_yen and the sticker price as markdown_unit_price_yen.
  // The database then checks the list price by exact match and claims one discount slot.
  async function adoptMarkdownPrices(listPrice: number) {
    if (!currentRow || !batch || !draft || !markdownReference?.sticker_price_yen) return
    if (carriedRowReasonMissing(currentRow)) return
    const nextDraft = {
      ...draft,
      unit_price_yen: String(listPrice),
      markdown_unit_price_yen: String(markdownReference.sticker_price_yen),
    }
    setDraft(nextDraft)
    setOperation({ kind: 'saving', message: '定価とシール価格を保存しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      await persistDraftValues(currentRow, inferMissingDraftUnit(nextDraft), true)
      const detail = await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      const refreshedRow = detail.rows.find((row) => row.shipment_review_row_id === currentRow.shipment_review_row_id)
      const stillOpen = refreshedRow?.issues.some((item) => (
        item.issue_status === 'open' && SALES_MATCH_REQUIRED_ISSUE_CODES.has(item.code)
      ))
      setOperation(stillOpen
        ? { kind: 'error', message: '定価とシール価格を保存しましたが、販売実績と一致しないか、値引枠が残っていません。値を確認するか登録取下にしてください。', retryable: false }
        : { kind: 'success', message: '定価とシール価格を保存し、値引販売の枠を確保しました。', retryable: false })
    } catch (error) {
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id).catch(() => {})
      setOperation(errorState(error))
    }
  }

  async function splitCurrentRow() {
    if (!currentRow || !batch || !draft) return
    const total = Number(valueText(displayedObservation(currentRow, 'shipment_package_quantity')?.normalized_value))
    if (!Number.isInteger(total) || total < 2) {
      setOperation({ kind: 'error', message: '数量が2以上の行だけ分割できます。', retryable: false })
      return
    }
    const answer = window.prompt(`新しい行へ移す個数を入力してください（1〜${total - 1}）。\n値引シールを貼った分を移し、移した行にシール価格を入力します。`, '1')
    if (answer === null) return
    const quantity = Number(answer.trim())
    if (!Number.isInteger(quantity) || quantity < 1 || quantity >= total) {
      setOperation({ kind: 'error', message: `移す個数は1〜${total - 1}の整数で入力してください。`, retryable: false })
      return
    }
    if (carriedRowReasonMissing(currentRow)) return
    setOperation({ kind: 'saving', message: '行を分割しています…', retryable: false })
    try {
      await prepareRow(currentRow)
      const result = await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: 'split_row',
        quantity,
        notes: decisionReason.trim() || `${quantity}個を値引分として分割`,
      }) as { split_row_id?: string }
      await refreshBatch(batch.import_batch_id, result.split_row_id ?? currentRow.shipment_review_row_id)
      setOperation({
        kind: 'success',
        message: `${quantity}個を新しい行に分けました。値引分の行に「シール価格」を入力するか、値引販売の候補から採用してください。`,
        retryable: false,
      })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function closeIssue(issue: ShipmentReviewIssue) {
    if (!currentRow || !batch || !draft) return
    if (carriedRowReasonMissing(currentRow)) return
    setOperation({ kind: 'saving', message: '警告の処理結果を保存しています…', retryable: false })
    try {
      const completedDraft = inferMissingDraftUnit(draft)
      setDraft(completedDraft)
      await prepareRow(currentRow)
      await persistDraftValues(currentRow, completedDraft, true)
      const detail = await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      const refreshedRow = detail.rows.find((row) => (
        row.shipment_review_row_id === currentRow.shipment_review_row_id
      ))
      const refreshedIssue = refreshedRow?.issues.find((item) => (
        item.shipment_review_issue_id === issue.shipment_review_issue_id
        && item.issue_status === 'open'
      )) ?? refreshedRow?.issues.find((item) => (
        item.issue_status === 'open'
        && item.code === issue.code
        && item.field_name === issue.field_name
      ))
      if (!refreshedIssue) {
        setOperation({ kind: 'success', message: '入力内容を保存し、警告を自動解決しました。', retryable: false })
        return
      }
      await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: refreshedIssue.severity === 'error' ? 'resolve_issue' : 'accept_issue',
        issue_id: refreshedIssue.shipment_review_issue_id,
        notes: refreshedIssue.severity === 'error' ? '入力値を確認・修正して解決' : '内容を確認して許容',
      })
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({ kind: 'success', message: '警告の処理結果を保存しました。', retryable: false })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function applyProductCorrectionToMatchingRows() {
    if (!currentRow || !batch || !draft || bulkProductCorrectionRows.length < 2) return
    const nextProduct = draft.product.trim()
    if (!window.confirm(
      `読取品名「${currentStoredProduct}」の${bulkProductCorrectionRows.length}行を「${nextProduct}」へ修正しますか？\n各行は確認中に戻るため、画像を確認して承認してください。`,
    )) return
    setOperation({ kind: 'saving', message: '同じ誤読の品目をまとめて修正しています…', retryable: false })
    try {
      for (const row of bulkProductCorrectionRows) {
        await prepareRow(row)
        const previous = displayedObservation(row, 'product')
        await apply({
          shipment_review_row_id: row.shipment_review_row_id,
          expected_row_status: 'in_review',
          action_type: 'correct_value',
          field_name: 'product',
          raw_value: previous?.raw_value ?? currentStoredProduct,
          normalized_value: nextProduct,
          confidence: 'high',
          evidence: {
            source: 'shipment_review_ui',
            bulk_product_correction: true,
            previous_product: currentStoredProduct,
          },
          notes: `同じ読取品名「${currentStoredProduct}」を一括修正`,
        })
      }
      await refreshBatch(batch.import_batch_id, currentRow.shipment_review_row_id)
      setOperation({
        kind: 'success',
        message: `${bulkProductCorrectionRows.length}行の品目を修正しました。各行を画像と照合して承認してください。`,
        retryable: false,
      })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function decide(actionType: 'approve' | 'defer' | 'mark_no_shipment' | 'reject_row') {
    if (!currentRow || !batch || !draft) return
    if (actionType !== 'approve' && !decisionReason.trim()) {
      setOperation({ kind: 'error', message: 'この判断には理由を入力してください。', retryable: false })
      return
    }
    if (carriedRowReasonMissing(currentRow)) return
    setOperation({ kind: 'saving', message: '行の判断を保存しています…', retryable: false })
    try {
      const nextRowId = shipmentReviewDecisionAdvances(actionType)
        ? rows[currentIndex + 1]?.shipment_review_row_id
        : undefined
      await prepareRow(currentRow)
      if (actionType === 'approve') {
        const completedDraft = inferMissingDraftUnit(draft)
        setDraft(completedDraft)
        await persistDraftValues(currentRow, completedDraft, true)
      }
      await apply({
        shipment_review_row_id: currentRow.shipment_review_row_id,
        expected_row_status: 'in_review',
        action_type: actionType,
        notes: decisionReason.trim() || undefined,
      })
      await refreshBatch(batch.import_batch_id, nextRowId ?? currentRow.shipment_review_row_id)
      setOperation({
        kind: 'success',
        message: nextRowId
          ? actionType === 'approve'
            ? '入力値と承認をDBへ保存し、次の行へ移動しました。'
            : '保留をDBへ保存し、次の行へ移動しました。'
          : '行の判断をDBへ保存しました。',
        retryable: false,
      })
    } catch (error) {
      setOperation(errorState(error))
    }
  }

  async function approveCorrectionDiff() {
    if (!batch || !correctionDiff) return
    if (!window.confirm('表示している前版との差分を承認しますか？\n承認後に行を変更した場合は、もう一度承認が必要です。')) return
    setOperation({ kind: 'saving', message: '前版との差分を承認しています…', retryable: false })
    try {
      await getShipmentReviewApi().approveCorrectionDiff(batch.import_batch_id, correctionDiff.diff_sha256)
      await refreshBatch(batch.import_batch_id, currentRow?.shipment_review_row_id)
      setOperation({ kind: 'success', message: '差分を承認しました。本番反映できます。', retryable: false })
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
            <input type="file" accept="image/*" multiple onChange={(event) => { loadImages(event.target.files); event.target.value = '' }} />
            <small>{Object.keys(imageUrls).length ? `${Object.keys(imageUrls).length}枚を読込済み（続けて選ぶと追加）` : '同じ月の画像を選択（複数回に分けて追加できます）'}</small>
          </label>
          <label className="file-picker">
            <span>DB上のバッチ</span>
            <select value={batch?.import_batch_id ?? ''} disabled={isBusy} onChange={(event) => void selectBatch(event.target.value)}>
              <option value="">選択してください</option>
              {batches.map((item) => (
                <option key={item.import_batch_id} value={item.import_batch_id}>
                  {item.source_month.slice(0, 7)} v{item.report_version}{item.batch_kind === 'correction' ? '（訂正）' : ''}・{item.pending_count ? `未完了${item.pending_count}行` : item.finalized_at ? '反映済み' : '判断済み'}
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
            <div className="excluded"><strong>{counts.no_shipment}</strong><span>登録取下</span></div>
            <div className="review-progress-note"><p>v{batch.report_version} / {batch.source_month.slice(0, 7)}{isCorrectionBatch ? '・訂正' : ''}</p><small>{isCorrectionBatch ? `訂正理由：${batch.correction_reason ?? '—'}` : 'DBを正本として保存'}</small></div>
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
              <span>{batch.finalized_at ? '本番反映済み' : canFinalize ? '反映準備完了' : isCorrectionBatch ? '全行判断・差分承認後に反映' : '全行判断後に反映'}</span>
              <button className="secondary-button compact" type="button" disabled={isBusy} onClick={() => downloadAuditCsv(rows)}>監査CSV</button>
              <button className="secondary-button compact" type="button" disabled={isBusy} onClick={() => downloadAuditSnapshot(batch)}>完全監査JSON</button>
              <button className="primary-button compact" type="button" disabled={!canFinalize || isBusy} onClick={() => void finalizeBatch()}>本番反映</button>
            </div>
          </div>

          {isCorrectionBatch && (
            <section className="panel correction-diff-panel" aria-label="前版との差分">
              <div className="panel-heading"><div><p className="section-kicker">CORRECTION DIFF</p><h2>前版との差分</h2></div>
                <div className="correction-diff-approval">
                  {batch.finalized_at ? <span className="correction-diff-badge approved">反映済み</span>
                    : correctionState.approvalCurrent ? <span className="correction-diff-badge approved">この差分は承認済み</span>
                      : correctionDiff?.latest_approval ? <span className="correction-diff-badge stale">承認後に内容が変わりました（再承認が必要）</span>
                        : <span className="correction-diff-badge">未承認</span>}
                  {!batch.finalized_at && <button className="primary-button compact" type="button" disabled={isBusy || !correctionState.canApprove || correctionState.approvalCurrent} onClick={() => void approveCorrectionDiff()}>この差分を承認</button>}
                </div>
              </div>
              <p className="muted">本番の現在の版を、この訂正バッチの内容で日ごとに置き換えます。救済だけが目的の訂正では、期待される差分は「追加」だけです。</p>
              {correctionDiffError ? <p className="review-reference-caption">差分を取得できませんでした。最新状態を再読込してください。</p>
                : !correctionDiff ? <p className="review-reference-caption">差分を計算しています…</p>
                  : <>
                    {correctionState.blockers.length > 0 && !batch.finalized_at && <ul className="correction-diff-blockers">{correctionState.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
                    {correctionDiff.diff.days.map((day) => (
                      <div className="correction-diff-day" key={`${day.market_code}-${day.shipment_date}`}>
                        <h3>{day.shipment_date}・{day.market_code}<small>v{day.active_report_version ?? '?'} → v{correctionDiff.diff.report_version}</small></h3>
                        <p className="correction-diff-totals">明細 {day.before.line_count} → {day.after.line_count}行・数量 {day.before.package_quantity} → {day.after.package_quantity}・金額 {day.before.amount_yen.toLocaleString('ja-JP')} → {day.after.amount_yen.toLocaleString('ja-JP')}円・変更なし {day.unchanged_count}行</p>
                        {day.added.length > 0 && <div className="correction-diff-group added"><strong>追加 {day.added.length}行</strong><ul>{day.added.map((line) => <li key={line.shipment_review_row_id}>{formatCorrectionLine(line)}<small>{formatCorrectionSource(line)}</small></li>)}</ul></div>}
                        {day.changed.length > 0 && <div className="correction-diff-group changed"><strong>変更 {day.changed.length}行</strong><ul>{day.changed.map((change) => <li key={change.shipment_line_id}>{formatCorrectionLine(change.after)}<small>{formatCorrectionSource(change.before)}</small><span>{(change.changed_fields ?? []).map((field) => `${correctionFieldLabel(field)}：${formatCorrectionValue(field, change.before[field as keyof typeof change.before])} → ${formatCorrectionValue(field, change.after[field as keyof typeof change.after])}`).join('、')}</span></li>)}</ul></div>}
                        {day.removed.length > 0 && <div className="correction-diff-group removed"><strong>削除 {day.removed.length}行</strong><ul>{day.removed.map((line) => <li key={line.shipment_line_id}>{formatCorrectionLine(line)}<small>{formatCorrectionSource(line)}</small><span>理由：{line.reason ?? '—'}</span></li>)}</ul></div>}
                      </div>
                    ))}
                    {correctionDiff.diff.excluded_target_rows.length > 0 && <div className="correction-diff-group excluded"><strong>取り込まない対象行 {correctionDiff.diff.excluded_target_rows.length}行</strong><ul>{correctionDiff.diff.excluded_target_rows.map((row) => <li key={row.shipment_review_row_id}>{row.shipment_date} {row.source_page} {row.source_row}行目・{statusLabels[row.row_status]}<span>理由：{row.reason ?? '—'}</span></li>)}</ul></div>}
                  </>}
            </section>
          )}

          <div className="shipment-review-workspace">
            <section className="panel source-image-panel">
              <div className="panel-heading"><div><p className="section-kicker">SOURCE IMAGE</p><h2>{currentRow.source_page}</h2></div>
                <label className="image-zoom">表示倍率 {zoom}%<input type="range" min="60" max="180" step="10" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
              </div>
              <div className="source-image-body">
                <nav className="source-row-rail" aria-label="このページの行">
                  <div className="source-row-rail-inner">
                    <span className="source-row-rail-caption">行</span>
                    <div className="source-row-rail-list" ref={rowRailRef}>
                      {pageRows.map(({ row, index }) => (
                        <button
                          className={`${index === currentIndex ? 'is-current' : ''} ${row.row_status}${isCarriedOverShipmentReviewRow(row) ? ' carried' : ''}${valueText(displayedObservation(row, 'markdown_unit_price_yen')?.normalized_value) ? ' markdown' : ''}`}
                          type="button"
                          key={row.shipment_review_row_id}
                          aria-current={index === currentIndex ? 'true' : undefined}
                          title={`${row.source_row}行目・${statusLabels[row.row_status]}${isCarriedOverShipmentReviewRow(row) ? '・前版から引継ぎ' : ''}`}
                          onClick={() => setCurrentIndex(index)}
                        >
                          {row.source_row}{splitPartPosition(row, rows) && <small className="source-row-part">{splitPartPosition(row, rows)}</small>}
                          {row.issues.some((issue) => issue.issue_status === 'open' && issue.severity !== 'info') && <span aria-label="警告あり">!</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </nav>
                <div className="source-image-scroll" ref={imageScrollRef}>
                  {pageImageUrl ? <><div className="source-image-stage" style={{ width: `${zoom}%` }}><img ref={sourceImageRef} src={pageImageUrl} alt={`${currentRow.source_page}の原画像`} onLoad={() => focusCurrentImageRow(false)} /><span className="source-row-highlight" style={{ top: `${currentRowTop}%` }} aria-hidden="true" /></div><div className="source-image-scroll-spacer" aria-hidden="true" /></>
                    : <div className="image-placeholder"><strong>このページの画像が選択されていません</strong><span>画像はSupabaseへ送信されません。</span></div>}
                </div>
              </div>
            </section>

            <section className="panel review-editor-panel">
              <header className="review-editor-header">
                <div className="review-row-heading"><div><p className="section-kicker">ROW {currentRow.source_row}{currentSplitPosition ? `（分割 ${currentSplitPosition}）` : ''}</p><h2>{draft.product || '品目名未入力'}</h2></div>
                  <span className={`review-status ${currentRow.row_status}`}>{statusLabels[currentRow.row_status]}</span>
                </div>
                {currentMarkdownLabel ? <p className="review-origin-badge markdown">{currentMarkdownLabel}{currentSplitPosition ? `・同じ帳票行の${currentSplitPosition}` : ''}</p>
                  : currentSplitPosition ? <p className="review-origin-badge plain">通常分・同じ帳票行の{currentSplitPosition}</p> : null}
                {currentRowIsCarried && <p className="review-origin-badge carried">前版から引継ぎ：本番に取り込み済みの明細を写した行です。変更・取下には判断理由が必要です。</p>}
                {currentRow.carried_from_review_row_id && <p className="review-origin-badge rereview">以前のバッチで取下・保留した行の再確認です。</p>}
                <div className="review-row-toolbar">
                  <button className="text-link-button" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>前の行</button>
                  <strong>{currentIndex + 1} / {rows.length}</strong>
                  <span className={`review-warning-status${openErrorCount + openWarningCount ? ' needs-review' : ''}`}>{openErrorCount + openWarningCount ? `要確認 ${openErrorCount + openWarningCount}` : '警告なし'}</span>
                  <button className="text-link-button" type="button" disabled={currentIndex === rows.length - 1} onClick={() => setCurrentIndex((index) => Math.min(rows.length - 1, index + 1))}>次の行</button>
                </div>
              </header>
              <div className="review-editor-scroll">
                <dl className="raw-observation"><div><dt>出荷日</dt><dd>{currentRow.shipment_date}</dd></div><div><dt>市場</dt><dd>{currentRow.market_code}</dd></div><div><dt>原記載の備考</dt><dd>{currentRow.raw_notes || '—'}</dd></div></dl>

                <div className="review-fields">{fieldDefinitions.map((field) => {
                  const fieldCandidates = candidates.filter((candidate) => candidate.field_name === field.key)
                  const inputId = `shipment-review-${field.key}`
                  const isWide = field.key === 'product' || fieldCandidates.length > 3
                    || (field.key === 'unit_price_yen' && (Boolean(openTaxAdjustedPriceIssue) || showMarkdownReference))
                  return <div className={`review-field${isWide ? ' wide' : ''}`} key={field.key}>
                    <label htmlFor={inputId}>{field.label}<span className={`review-field-initial${draftDiffersFromInitial(currentRow, field.key, draft[field.key]) ? ' is-changed' : ''}`}>（初期値：{initialValueText(currentRow, field.key)}）</span></label>
                    <input id={inputId} type="text" inputMode={field.inputMode} value={draft[field.key]} disabled={isBusy || Boolean(batch.finalized_at)} onChange={(event) => updateDraftField(field.key, event.target.value)} onBlur={field.key === 'content_value' ? () => setDraft((value) => value ? inferMissingDraftUnit(value) : value) : undefined} />
                    {field.key === 'product' && bulkProductCorrectionRows.length > 1 && <button className="secondary-button compact review-bulk-product-correction" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void applyProductCorrectionToMatchingRows()}>同じ「{currentStoredProduct}」表記の{bulkProductCorrectionRows.length}行を一括修正</button>}
                    {fieldCandidates.length > 0 && <div className="review-field-candidates" aria-label={`${field.label}の修正候補`}><span>候補をクリックして採用</span>{fieldCandidates.map((candidate) => <div className="review-candidate-chip" key={candidate.shipment_field_observation_id}><button type="button" className="review-candidate-value" disabled={isBusy} title={`採用（確度: ${candidate.confidence}）`} onClick={() => void actOnCandidate(candidate, true)}>{valueText(candidate.normalized_value)}を採用</button><button type="button" className="review-candidate-reject" disabled={isBusy} aria-label={`${field.label}候補 ${valueText(candidate.normalized_value)} を却下`} title="候補を却下" onClick={() => void actOnCandidate(candidate, false)}>却下</button></div>)}</div>}
                    {field.key === 'unit_price_yen' && openTaxAdjustedPriceIssue && (
                      <div className="review-field-reference" aria-label="販売実績側の税込単価を単価として採用">
                        {taxAdjustedReferenceError ? (
                          <p className="review-reference-caption">販売実績を取得できませんでした。開き直すか、値を修正するか、行を「登録取下」にしてください。</p>
                        ) : !taxAdjustedReference ? (
                          <p className="review-reference-caption">販売実績を確認しています…</p>
                        ) : taxAdjustedReference.matches.length === 0 ? (
                          // The tax_adjusted_price_match_candidate issue is static from bundle import and
                          // reflects the price at that time; a live check can still find no relationship
                          // (not even a tax-adjusted one) at the row's current price.
                          <p className="review-reference-caption">販売実績と一致しません。値を修正するか登録取下にしてください。</p>
                        ) : (
                          <>
                            <p className="review-reference-caption">販売実績と一致しませんが、下の販売実績（税込価格）と税抜換算で一致します。値を修正するか登録取下にしてください。</p>
                            <div className="review-field-candidates">
                              {dedupeTaxAdjustedMatches(taxAdjustedReference.matches).map((group) => (
                                <button
                                  type="button"
                                  className="review-reference-chip review-reference-adopt"
                                  key={group.sales_unit_price_yen}
                                  disabled={isBusy}
                                  title={`採用すると単価欄が${group.sales_unit_price_yen}円になります`}
                                  onClick={() => void adoptTaxAdjustedSalesPrice(group.matches[0])}
                                >
                                  税込{group.sales_unit_price_yen}円を単価として採用（{group.dates.join('・')}・計{group.totalQuantity}点）
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {field.key === 'unit_price_yen' && showMarkdownReference && (
                      <div className="review-field-reference markdown" aria-label="値引シールの価格と値引販売">
                        {markdownReferenceError ? (
                          <p className="review-reference-caption">値引販売の実績を取得できませんでした。開き直してください。</p>
                        ) : !markdownReference ? (
                          <p className="review-reference-caption">値引販売の実績を確認しています…</p>
                        ) : (
                          <>
                            {markdownReference.markdown_unit_price_yen !== null && (
                              <p className="review-reference-caption">
                                {markdownReference.slot_secured
                                  ? '値引販売の枠を確保しています。'
                                  : <strong>対応する値引販売の枠が残っていません。値を見直すか、行を「登録取下」にしてください。</strong>}
                              </p>
                            )}
                            {markdownReference.matches.length > 0 && markdownReference.markdown_unit_price_yen === null && (
                              <>
                                <p className="review-reference-caption">帳票の{markdownReference.sticker_price_yen}円は、下の値引販売の値引後価格と一致します。値引シールを貼った出荷なら、定価とシール価格として採用してください。</p>
                                <div className="review-field-candidates">
                                  {groupMarkdownMatches(markdownReference.matches).map((group) => (
                                    <button
                                      type="button"
                                      className="review-reference-chip review-reference-adopt"
                                      key={group.listPrice}
                                      disabled={isBusy}
                                      title={`採用すると単価欄が${group.listPrice}円、シール価格欄が${markdownReference.sticker_price_yen}円になります`}
                                      onClick={() => void adoptMarkdownPrices(group.listPrice)}
                                    >
                                      定価{group.listPrice}円・シール{markdownReference.sticker_price_yen}円（{group.rate}%引）として採用（{group.dates.join('・')}・値引{group.discountedUnits}個）
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                            {markdownReference.matches.length === 0 && markdownReference.markdown_unit_price_yen === null
                              && markdownReferenceIssue?.code === 'markdown_price_match_candidate' && (
                              <p className="review-reference-caption">今の単価に対応する値引販売は見つかりません。値を修正するか登録取下にしてください。</p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                })}</div>

                {openIssues.length > 0 && <details className="review-issues" key={currentRow.shipment_review_row_id} open={openErrorCount + openWarningCount > 0}><summary><strong>警告・確認事項</strong><span>{openErrorCount > 0 && `エラー ${openErrorCount}件`}{openErrorCount > 0 && openWarningCount > 0 && '・'}{openWarningCount > 0 && `警告 ${openWarningCount}件`}{(openErrorCount > 0 || openWarningCount > 0) && openInfoCount > 0 && '・'}{openInfoCount > 0 && `情報 ${openInfoCount}件`}</span></summary><p className="review-issue-guidance">エラー・警告は解決するまで承認をブロックします。単価・品目名の販売実績との不一致は、値を修正して一致させるか、行を「登録取下」にすることでのみ解消できます（「確認して許容」では閉じられません）。それ以外は入力値を保存した後、「修正済みとして解決」または「確認して許容」を押してください。</p><div className="review-db-list">{openIssues.map((issue) => <div className={`review-db-item ${issue.severity}`} key={issue.shipment_review_issue_id}><div><strong>{issueTitle(issue.code, issue.field_name, issue.severity)}</strong><details className="review-issue-technical"><summary>詳細</summary><code>{issue.code}</code><span>{issue.message}</span></details></div>{SALES_MATCH_REQUIRED_ISSUE_CODES.has(issue.code) ? <span className="review-issue-sales-match-note">値を修正して販売実績と一致させるか、行を「登録取下」にしてください</span> : <button type="button" className="secondary-button compact" disabled={isBusy} onClick={() => void closeIssue(issue)}>{issue.severity === 'error' ? '修正済みとして解決' : '確認して許容'}</button>}</div>)}</div></details>}

                <details className="review-history"><summary>操作履歴（{currentRow.actions.length}件）</summary>{currentRow.actions.length ? <ol>{currentRow.actions.map((action) => <li key={action.shipment_review_action_id}><time>{new Date(action.acted_at).toLocaleString('ja-JP')}</time> {action.action_type}{action.notes ? ` — ${action.notes}` : ''}</li>)}</ol> : <p>操作履歴はまだありません。</p>}</details>
                <div className="review-action-dock">
                  <label className="review-decision-reason">判断理由・コメント<input type="text" value={decisionReason} disabled={isBusy || Boolean(batch.finalized_at)} onChange={(event) => setDecisionReason(event.target.value)} placeholder={currentRowIsCarried ? '引継ぎ行の変更・承認し直し・取下では必須' : '保留・登録取下・差し戻しでは必須'} /></label>
                  <div className="review-action-buttons"><button className="secondary-button review-confirm-fields" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void confirmFields()}>入力を保存</button><button className="primary-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('approve')}>承認</button><button className="secondary-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('defer')}>保留</button><button className="danger-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('mark_no_shipment')}>登録取下</button><button className="text-link-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} onClick={() => void decide('reject_row')}>差し戻し</button><button className="text-link-button" type="button" disabled={isBusy || Boolean(batch.finalized_at)} title="1行に通常品と値引シール品が混在する場合に、値引分を別の行へ分けます" onClick={() => void splitCurrentRow()}>行を分割</button></div>
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
