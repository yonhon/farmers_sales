// CSV export of the tables shown on the sales pages. Numbers stay unformatted so
// spreadsheets can sum them; the BOM lets Excel open the Japanese headers as UTF-8.

export type CsvCell = string | number | null | undefined

function csvCell(value: CsvCell) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeTableCsv(header: readonly string[], records: readonly (readonly CsvCell[])[]) {
  return `﻿${[header, ...records].map((record) => record.map(csvCell).join(',')).join('\r\n')}\r\n`
}

// Characters Windows forbids in file names are replaced so a product name is safe to use.
export function tableCsvFilename(parts: readonly string[]) {
  return `${parts.map((part) => part.replace(/[\\/:*?"<>|\s]+/g, '_')).join('_')}.csv`
}

export function downloadTableCsv(filename: string, header: readonly string[], records: readonly (readonly CsvCell[])[]) {
  const blob = new Blob([serializeTableCsv(header, records)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
