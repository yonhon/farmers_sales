const june2026PhysicalRows: Record<string, number[]> = {
  'スキャン_20260901-1655-01.jpg': [10, 11, 12, ...range(14, 32)],
  'スキャン_20260901-1655-02.jpg': [...range(0, 12), ...range(20, 35)],
  'スキャン_20260901-1655-03.jpg': [...range(0, 13), ...range(20, 24), ...range(30, 39)],
  'スキャン_20260901-1655-04.jpg': [...range(0, 6), ...range(10, 23), ...range(30, 39)],
  'スキャン_20260901-1655-05.jpg': [...range(0, 6), ...range(10, 24), ...range(30, 34)],
  'スキャン_20260901-1655-06.jpg': [...range(0, 14), ...range(20, 31)],
  'スキャン_20260901-1655-07.jpg': [...range(0, 16), 20, 21, ...range(30, 39)],
  'スキャン_20260901-1655-08.jpg': [...range(0, 8), ...range(10, 21), ...range(30, 37)],
  'スキャン_20260901-1655-09.jpg': [...range(0, 5), 10, 20, 30, 31],
}

function range(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

export function shipmentReviewPhysicalRow(sourcePage: string, sourceRow: number, pageRowPosition: number) {
  return june2026PhysicalRows[sourcePage]?.[pageRowPosition] ?? sourceRow
}

