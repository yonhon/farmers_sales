export const SHIPMENT_REVIEW_COLUMNS = [
  'source_page',
  'source_row',
  'shipment_date',
  'market_code',
  'raw_product_name',
  'resolved_product_name',
  'raw_content',
  'content_value',
  'content_unit',
  'unit_price_yen',
  'total_package_quantity',
  'destination',
  'raw_notes',
  'review_required',
  'review_note',
  'comment',
] as const

export type ShipmentReviewColumn = typeof SHIPMENT_REVIEW_COLUMNS[number]
export type ShipmentReviewRow = Record<ShipmentReviewColumn, string>
export type ShipmentReviewDecision = 'pending' | 'approved' | 'held' | 'excluded'

export type ShipmentReviewItem = {
  id: string
  row: ShipmentReviewRow
  original: ShipmentReviewRow
  decision: ShipmentReviewDecision
}

function parseCsvRecords(value: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''))
      records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || record.length) {
    record.push(field.replace(/\r$/, ''))
    records.push(record)
  }
  return records
}

export function parseShipmentReviewCsv(value: string): ShipmentReviewItem[] {
  const records = parseCsvRecords(value.replace(/^\uFEFF/, ''))
  const header = records.shift() ?? []
  const missing = SHIPMENT_REVIEW_COLUMNS.filter((column) => !header.includes(column))
  if (missing.length) {
    throw new Error(`必要な列がありません: ${missing.join(', ')}`)
  }

  const indices = Object.fromEntries(header.map((column, index) => [column, index]))
  return records
    .filter((record) => record.some((field) => field.trim()))
    .map((record, index) => {
      const row = Object.fromEntries(
        SHIPMENT_REVIEW_COLUMNS.map((column) => [column, record[indices[column]] ?? '']),
      ) as ShipmentReviewRow
      const original = { ...row }
      return {
        id: `${row.source_page}:${row.source_row}:${index}`,
        row,
        original,
        decision: row.review_required.trim().toUpperCase() === 'FALSE' ? 'approved' : 'pending',
      }
    })
}

function quoteCsvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function serializeReviewedShipments(items: ShipmentReviewItem[]): string {
  const rows = items
    .filter((item) => item.decision !== 'excluded')
    .map((item) => SHIPMENT_REVIEW_COLUMNS.map((column) => {
      if (column === 'review_required') {
        return item.decision === 'approved' ? 'FALSE' : 'TRUE'
      }
      return item.row[column]
    }))
  return [
    SHIPMENT_REVIEW_COLUMNS.join(','),
    ...rows.map((row) => row.map(quoteCsvField).join(',')),
  ].join('\r\n') + '\r\n'
}

export function sourcePageNumber(sourcePage: string): number | null {
  const match = sourcePage.match(/-(\d+)\.[^.]+$/)
  return match ? Number(match[1]) : null
}

const ROUTINE_REVIEW_NOTES = new Set([
  '8月分AI転記・人手確認待ち',
  '品目名を同上記号から補完・人手確認待ち',
])

export function isPriorityReviewItem(item: ShipmentReviewItem): boolean {
  const note = item.row.review_note.trim()
  return Boolean(note) && !ROUTINE_REVIEW_NOTES.has(note)
}

export function hasRowChanged(item: ShipmentReviewItem): boolean {
  return SHIPMENT_REVIEW_COLUMNS.some((column) => item.row[column] !== item.original[column])
}

export function nextPendingIndex(items: ShipmentReviewItem[], currentIndex: number): number {
  if (!items.length) return -1
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (currentIndex + offset) % items.length
    if (items[index].decision === 'pending') return index
  }
  return currentIndex
}
