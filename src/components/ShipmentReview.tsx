import { useEffect, useMemo, useState } from 'react'

import {
  hasRowChanged,
  isPriorityReviewItem,
  nextPendingIndex,
  parseShipmentReviewCsv,
  serializeReviewedShipments,
  sourcePageNumber,
} from '../lib/shipmentReview'
import type {
  ShipmentReviewColumn,
  ShipmentReviewDecision,
  ShipmentReviewItem,
} from '../lib/shipmentReview'

const decisionLabels: Record<ShipmentReviewDecision, string> = {
  pending: '未確認',
  approved: '承認済み',
  held: '保留',
  excluded: '出荷なし',
}

type EditableField = {
  key: ShipmentReviewColumn
  label: string
  inputMode?: 'numeric' | 'text'
}

const editableFields: EditableField[] = [
  { key: 'shipment_date', label: '出荷日' },
  { key: 'resolved_product_name', label: '品目名' },
  { key: 'content_value', label: '内容量', inputMode: 'numeric' },
  { key: 'content_unit', label: '単位' },
  { key: 'unit_price_yen', label: '単価（円）', inputMode: 'numeric' },
  { key: 'total_package_quantity', label: '数量', inputMode: 'numeric' },
  { key: 'destination', label: '出荷先' },
  { key: 'comment', label: '確認コメント' },
]

function compareRows(left: ShipmentReviewItem, right: ShipmentReviewItem) {
  const leftPage = sourcePageNumber(left.row.source_page) ?? Number.MAX_SAFE_INTEGER
  const rightPage = sourcePageNumber(right.row.source_page) ?? Number.MAX_SAFE_INTEGER
  return leftPage - rightPage
    || Number(left.row.source_row) - Number(right.row.source_row)
    || left.id.localeCompare(right.id)
}

function downloadCsv(items: ShipmentReviewItem[]) {
  const blob = new Blob(['\uFEFF', serializeReviewedShipments(items)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'transcription_reviewed.csv'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ShipmentReview() {
  const [items, setItems] = useState<ShipmentReviewItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [csvName, setCsvName] = useState('')
  const [storageKey, setStorageKey] = useState('')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const [zoom, setZoom] = useState(100)

  useEffect(() => () => {
    Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url))
  }, [imageUrls])

  useEffect(() => {
    if (!storageKey || !items.length) return
    const savedItems = items.map(({ id, row, decision }) => ({ id, row, decision }))
    window.localStorage.setItem(storageKey, JSON.stringify(savedItems))
  }, [items, storageKey])

  const currentItem = items[currentIndex] ?? null
  const pages = useMemo(
    () => [...new Set(items.map((item) => item.row.source_page))]
      .sort((left, right) => (sourcePageNumber(left) ?? 999) - (sourcePageNumber(right) ?? 999)),
    [items],
  )
  const pageItems = useMemo(
    () => currentItem
      ? items.map((item, index) => ({ item, index }))
        .filter(({ item }) => item.row.source_page === currentItem.row.source_page)
      : [],
    [currentItem, items],
  )
  const counts = useMemo(() => {
    const result: Record<ShipmentReviewDecision, number> = {
      pending: 0,
      approved: 0,
      held: 0,
      excluded: 0,
    }
    items.forEach((item) => { result[item.decision] += 1 })
    return result
  }, [items])
  const priorityCount = useMemo(
    () => items.filter(isPriorityReviewItem).length,
    [items],
  )
  const canExport = items.length > 0 && counts.pending === 0 && counts.held === 0

  async function loadCsv(file: File | undefined) {
    if (!file) return
    try {
      let parsed = parseShipmentReviewCsv(await file.text()).sort(compareRows)
      if (!parsed.length) throw new Error('確認対象の行がありません。')
      const nextStorageKey = `shipment-review:v1:${file.name}:${file.size}:${file.lastModified}`
      const saved = window.localStorage.getItem(nextStorageKey)
      if (saved) {
        try {
          const savedItems = JSON.parse(saved) as Array<Pick<ShipmentReviewItem, 'id' | 'row' | 'decision'>>
          const byId = new Map(savedItems.map((item) => [item.id, item]))
          parsed = parsed.map((item) => {
            const savedItem = byId.get(item.id)
            return savedItem
              ? { ...item, row: { ...item.row, ...savedItem.row }, decision: savedItem.decision }
              : item
          })
        } catch {
          // Ignore an unreadable local draft and start from the selected CSV.
        }
      }
      setItems(parsed)
      setCurrentIndex(Math.max(0, parsed.findIndex((item) => item.decision === 'pending')))
      setCsvName(file.name)
      setStorageKey(nextStorageKey)
      setLoadError('')
    } catch (error) {
      setItems([])
      setCsvName('')
      setStorageKey('')
      setLoadError(error instanceof Error ? error.message : 'CSVを読み込めませんでした。')
    }
  }

  function loadImages(files: FileList | null) {
    if (!files) return
    const next: Record<string, string> = {}
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) next[file.name] = URL.createObjectURL(file)
    })
    setImageUrls(next)
  }

  function updateField(column: ShipmentReviewColumn, value: string) {
    setItems((current) => current.map((item, index) => index === currentIndex
      ? {
          ...item,
          row: { ...item.row, [column]: value },
          decision: item.decision === 'approved' ? 'pending' : item.decision,
        }
      : item))
  }

  function decide(decision: ShipmentReviewDecision) {
    const next = items.map((item, index) => index === currentIndex
      ? { ...item, decision }
      : item)
    setItems(next)
    setCurrentIndex(nextPendingIndex(next, currentIndex))
  }

  function selectPage(sourcePage: string) {
    const pendingIndex = items.findIndex(
      (item) => item.row.source_page === sourcePage && item.decision === 'pending',
    )
    const firstIndex = items.findIndex((item) => item.row.source_page === sourcePage)
    setCurrentIndex(pendingIndex >= 0 ? pendingIndex : firstIndex)
  }

  const pageImageUrl = currentItem ? imageUrls[currentItem.row.source_page] : undefined

  return (
    <div className="shipment-review">
      <section className="panel shipment-review-setup">
        <div>
          <p className="section-kicker">LOCAL REVIEW FILES</p>
          <h2>確認するファイルを選択</h2>
          <p className="muted">
            ファイルはブラウザ内だけで読み込み、Supabaseや公開サイトには送信しません。
          </p>
        </div>
        <div className="shipment-file-inputs">
          <label className="file-picker">
            <span>転記CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void loadCsv(event.target.files?.[0])}
            />
            <small>{csvName || 'transcription_unverified.csvを選択'}</small>
          </label>
          <label className="file-picker">
            <span>原画像</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => loadImages(event.target.files)}
            />
            <small>{Object.keys(imageUrls).length ? `${Object.keys(imageUrls).length}枚を読込済み` : '同じ月の画像をまとめて選択'}</small>
          </label>
        </div>
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
      </section>

      {items.length > 0 && currentItem ? (
        <>
          <section className="review-progress" aria-label="確認状況">
            <div><strong>{items.length}</strong><span>全行</span></div>
            <div className="pending"><strong>{counts.pending}</strong><span>未確認</span></div>
            <div className="approved"><strong>{counts.approved}</strong><span>承認済み</span></div>
            <div className="held"><strong>{counts.held}</strong><span>保留</span></div>
            <div className="excluded"><strong>{counts.excluded}</strong><span>出荷なし</span></div>
          <div className="review-progress-note">
            <p>注意表示 {priorityCount}行</p>
            <small>進捗はこのブラウザに自動保存</small>
          </div>
        </section>

          <nav className="review-page-tabs" aria-label="原稿ページ">
            {pages.map((page) => {
              const pageRows = items.filter((item) => item.row.source_page === page)
              const pagePending = pageRows.filter((item) => item.decision === 'pending').length
              const number = sourcePageNumber(page)
              return (
                <button
                  className={page === currentItem.row.source_page ? 'is-active' : ''}
                  type="button"
                  key={page}
                  onClick={() => selectPage(page)}
                >
                  {number ? `${number.toString().padStart(2, '0')}ページ` : page}
                  <small>{pagePending ? `未確認 ${pagePending}` : '確認済み'}</small>
                </button>
              )
            })}
          </nav>

          <div className="shipment-review-workspace">
            <section className="panel source-image-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">SOURCE IMAGE</p>
                  <h2>{currentItem.row.source_page}</h2>
                </div>
                <label className="image-zoom">
                  表示倍率 {zoom}%
                  <input
                    type="range"
                    min="60"
                    max="180"
                    step="10"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="source-image-scroll">
                {pageImageUrl ? (
                  <img
                    src={pageImageUrl}
                    alt={`${currentItem.row.source_page}の原画像`}
                    style={{ width: `${zoom}%` }}
                  />
                ) : (
                  <div className="image-placeholder">
                    <strong>このページの画像が選択されていません</strong>
                    <span>{currentItem.row.source_page}を原画像欄から選択してください。</span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel review-editor-panel">
              <div className="review-row-heading">
                <div>
                  <p className="section-kicker">ROW {currentItem.row.source_row}</p>
                  <h2>{currentItem.row.resolved_product_name || '品目名未入力'}</h2>
                </div>
                <span className={`review-status ${currentItem.decision}`}>
                  {decisionLabels[currentItem.decision]}
                </span>
              </div>

              <div className="review-row-nav" aria-label="このページの行">
                {pageItems.map(({ item, index }) => (
                  <button
                    className={`${index === currentIndex ? 'is-current' : ''} ${item.decision}`}
                    type="button"
                    key={item.id}
                    title={`${item.row.resolved_product_name}：${decisionLabels[item.decision]}`}
                    onClick={() => setCurrentIndex(index)}
                  >
                    {item.row.source_row}
                    {isPriorityReviewItem(item) && <span aria-label="注意あり">!</span>}
                  </button>
                ))}
              </div>

              {isPriorityReviewItem(currentItem) && (
                <div className="review-warning" role="note">
                  <strong>この行は注意して確認してください</strong>
                  <span>{currentItem.row.review_note}</span>
                </div>
              )}

              <dl className="raw-observation">
                <div><dt>原記載の品目</dt><dd>{currentItem.row.raw_product_name || '—'}</dd></div>
                <div><dt>原記載の内容量</dt><dd>{currentItem.row.raw_content || '—'}</dd></div>
                <div><dt>原記載の備考</dt><dd>{currentItem.row.raw_notes || '—'}</dd></div>
              </dl>

              <div className="review-fields">
                {editableFields.map((field) => (
                  <label key={field.key} className={field.key === 'comment' ? 'wide' : ''}>
                    {field.label}
                    <input
                      type="text"
                      inputMode={field.inputMode}
                      value={currentItem.row[field.key]}
                      onChange={(event) => updateField(field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              {hasRowChanged(currentItem) && (
                <p className="edit-indicator">転記値を修正しています。内容を確認して承認してください。</p>
              )}

              <div className="review-actions">
                <button className="primary-button" type="button" onClick={() => decide('approved')}>
                  この内容で承認
                </button>
                <button className="secondary-button" type="button" onClick={() => decide('held')}>
                  保留
                </button>
                <button className="danger-button" type="button" onClick={() => decide('excluded')}>
                  出荷なし
                </button>
              </div>

              <div className="review-linear-nav">
                <button
                  className="text-link-button"
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                >
                  前の行
                </button>
                <span>{currentIndex + 1} / {items.length}</span>
                <button
                  className="text-link-button"
                  type="button"
                  disabled={currentIndex === items.length - 1}
                  onClick={() => setCurrentIndex((index) => Math.min(items.length - 1, index + 1))}
                >
                  次の行
                </button>
              </div>
            </section>
          </div>

          <section className={`panel review-export-panel${canExport ? ' ready' : ''}`}>
            <div>
              <p className="section-kicker">REVIEW OUTPUT</p>
              <h2>{canExport ? '全行の判断が完了しました' : '全行の判断後にCSVを出力できます'}</h2>
              <p className="muted">
                出荷なしの行は除外され、承認行のreview_requiredはFALSEになります。保留行がある間は出力できません。
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!canExport}
              onClick={() => downloadCsv(items)}
            >
              確認済みCSVを出力
            </button>
          </section>
        </>
      ) : (
        <section className="shipment-review-empty">
          <span aria-hidden="true">照</span>
          <h2>転記CSVを読み込むと確認を開始できます</h2>
          <p>原画像はCSVのsource_page列にあるファイル名と自動で対応付けます。</p>
        </section>
      )}
    </div>
  )
}
