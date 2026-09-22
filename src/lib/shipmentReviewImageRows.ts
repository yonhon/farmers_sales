// Physical-row corrections for the June 2026 review batch, whose printed sheets contain blank ruled
// rows (weekends with no shipment) that the transcription's source_row numbering skips over. Each
// entry maps a page's source_row (as recorded in that batch) to the row's actual position on the
// printed sheet, counting every ruled row including the blanks.
//
// The lookup is keyed by source_row, not by a row's position within whichever batch currently has the
// page loaded, because the same image can be reused by a later batch with different rows. Page 01
// (スキャン_20260901-1655-01.jpg) is also reused, unmapped, by the 2026-05 batch for its own 5/29 rows
// (source_row 0-8: the block the June batch itself excluded as a crossed-out duplicate at the top of
// the sheet). Keying by source_row lets those rows fall through to the identity mapping below instead
// of being misread against June's row 9-30 correction.
function physicalRowsBySourceRow(physicalRows: number[], firstSourceRow = 0): Record<number, number> {
  return Object.fromEntries(physicalRows.map((physicalRow, index) => [firstSourceRow + index, physicalRow]))
}

function range(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

const june2026PhysicalRows: Record<string, Record<number, number>> = {
  'スキャン_20260901-1655-01.jpg': physicalRowsBySourceRow([10, 11, 12, ...range(14, 32)], 9),
  'スキャン_20260901-1655-02.jpg': physicalRowsBySourceRow([...range(0, 12), ...range(20, 35)]),
  'スキャン_20260901-1655-03.jpg': physicalRowsBySourceRow([...range(0, 13), ...range(20, 24), ...range(30, 39)]),
  'スキャン_20260901-1655-04.jpg': physicalRowsBySourceRow([...range(0, 6), ...range(10, 23), ...range(30, 39)]),
  'スキャン_20260901-1655-05.jpg': physicalRowsBySourceRow([...range(0, 6), ...range(10, 24), ...range(30, 34)]),
  'スキャン_20260901-1655-06.jpg': physicalRowsBySourceRow([...range(0, 14), ...range(20, 31)]),
  'スキャン_20260901-1655-07.jpg': physicalRowsBySourceRow([...range(0, 16), 20, 21, ...range(30, 39)]),
  'スキャン_20260901-1655-08.jpg': physicalRowsBySourceRow([...range(0, 8), ...range(10, 21), ...range(30, 37)]),
  'スキャン_20260901-1655-09.jpg': physicalRowsBySourceRow([...range(0, 5), 10, 20, 30, 31]),
}

export function shipmentReviewPhysicalRow(sourcePage: string, sourceRow: number) {
  return june2026PhysicalRows[sourcePage]?.[sourceRow] ?? sourceRow
}
