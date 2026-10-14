import { describe, expect, it } from 'vitest'

import { serializeTableCsv, tableCsvFilename } from './tableCsv'

describe('serializeTableCsv', () => {
  it('writes a BOM, CRLF lines, and quotes cells that need it', () => {
    const csv = serializeTableCsv(['商品名', '純売上'], [
      ['ゴーヤー, 大', 1200],
      ['"島"らっきょう', null],
    ])

    expect(csv).toBe('﻿商品名,純売上\r\n"ゴーヤー, 大",1200\r\n"""島""らっきょう",\r\n')
  })

  it('writes only the header when there are no rows', () => {
    expect(serializeTableCsv(['日付'], [])).toBe('﻿日付\r\n')
  })
})

describe('tableCsvFilename', () => {
  it('replaces characters that are not allowed in file names', () => {
    expect(tableCsvFilename(['日別明細', 'A/B 品', '2026-10-01', '2026-10-15']))
      .toBe('日別明細_A_B_品_2026-10-01_2026-10-15.csv')
  })
})
