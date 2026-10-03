// Display helpers for markdown sticker rows
// (platform docs/decisions/007-shipment-markdown-sticker-price.md). unit_price_yen is the list price
// POS records; markdown_unit_price_yen is the sticker price applied at shipping time.

export type MarkdownSalesMatch = {
  report_date: string
  sales_unit_price_yen: number
  sold_quantity: number
  discount_amount_yen: number
  discounted_quantity: number
  discount_per_unit_yen: number
  discount_rate_percent: number
}

export type MarkdownSalesReference = {
  shipment_unit_price_yen: number | null
  markdown_unit_price_yen: number | null
  sticker_price_yen: number | null
  matches: MarkdownSalesMatch[]
  slot_secured: boolean | null
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function markdownRatePercent(listPrice: number, stickerPrice: number) {
  if (listPrice <= 0) return 0
  return Math.round((100 * (listPrice - stickerPrice)) / listPrice)
}

// "値引分（定価270円 → シール135円・50%引）", or null when the row has no sticker price.
export function markdownLabel(listPrice: unknown, stickerPrice: unknown) {
  const list = toNumber(listPrice)
  const sticker = toNumber(stickerPrice)
  if (list === null || sticker === null) return null
  return `値引分（定価${list}円 → シール${sticker}円・${markdownRatePercent(list, sticker)}%引）`
}

type PartRow = { source_page: string; source_row: number; source_part?: number | null }

// Position of a split part within its ledger row: "1/2", "2/2". Null for an unsplit ledger row.
export function splitPartPosition(row: PartRow, rows: PartRow[]) {
  const parts = rows
    .filter((item) => item.source_page === row.source_page && item.source_row === row.source_row)
    .map((item) => item.source_part ?? 0)
    .sort((left, right) => left - right)
  if (parts.length < 2) return null
  return `${parts.indexOf(row.source_part ?? 0) + 1}/${parts.length}`
}

// Groups adoptable matches by list price so one button covers a price sold on several dates.
export function groupMarkdownMatches(matches: MarkdownSalesMatch[]) {
  const groups = new Map<number, { listPrice: number; discountPerUnit: number; rate: number; dates: string[]; discountedUnits: number }>()
  matches.forEach((match) => {
    const group = groups.get(match.sales_unit_price_yen) ?? {
      listPrice: match.sales_unit_price_yen,
      discountPerUnit: match.discount_per_unit_yen,
      rate: match.discount_rate_percent,
      dates: [],
      discountedUnits: 0,
    }
    group.dates.push(match.report_date)
    group.discountedUnits += match.discounted_quantity
    groups.set(match.sales_unit_price_yen, group)
  })
  return [...groups.values()].sort((left, right) => left.listPrice - right.listPrice)
}
