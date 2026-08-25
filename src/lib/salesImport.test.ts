import { describe, expect, it } from 'vitest'

import { normalizeProductName, parseSalesText } from './salesImport'

const sample = `08/24 18:30 売上状況
県立農業大学校様
《やんばる市場》
大葉
@108 売 15
モロヘイヤ
@108 売 17
バジル
@250 売 27
キュウリ
@324 売 77
ゴーヤー
@324 売 2
@540 売 6
ミニトマト
@216 売 8
オクラ
@108 売 64
@150 売 27
食用ローゼル
@216 売 4
ガーベラ
@220 売 1
ケイトウ
@330 売 23
クルクマ
@187 売 2
★ 合 計 ★
売 273 ￥60,780

08/23 17:00 売上状況
県立農業大学校様
《やんばる市場》
バジル
@150 売 7
@250 売 12
食用ローゼル
@216 売 1
ケイトウ
@330 売 3
クルクマ
@187 売 1
★ 合 計 ★
売 24 ￥5,443

08/22 18:30 売上状況
県立農業大学校様
《やんばる市場》
バジル
@250 売 11
紅芋(美ら恋紅)
@300 売 1
食用ローゼル
@216 売 4
ガーベラ
@220 売 1
ケイトウ
@330 売 10
クルクマ
@187 売 1
ヘリコニア（大）
@220 売 3
レッドジンジャー
@165 売 4
ストレリチア
@165 売 2
★ 合 計 ★
売 37 ￥9,271

08/21 18:30 売上状況
県立農業大学校様
《やんばる市場》
大葉
@108 売 6
バジル
@150 売 2
@250 売 14
キュウリ
@324 売 53
ゴーヤー
@540 売 2
オクラ
@108 売 1
@150 売 30
紅芋(沖夢紫)
@349 売 1
紅芋(備瀬)
@300 売 1
食用ローゼル
@216 売 1
ケイトウ
@330 売 11
レッドジンジャー
@165 売 1
ストレリチア
@165 売 4
★ 合 計 ★
売 127 ￥32,628`

describe('sales paste parser', () => {
  it('parses the supplied four-day sample', () => {
    const result = parseSalesText(sample, 2026)

    expect(result.isValid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.reportCount).toBe(4)
    expect(result.lineCount).toBe(40)
    expect(result.soldQuantity).toBe(461)
    expect(result.netSalesYen).toBe(108_122)
    expect(result.reports[0]).toMatchObject({
      report_date: '2026-08-24',
      report_time: '18:30',
      recipient_name: '県立農業大学校',
      market_name: 'やんばる市場',
      calculated_sold_quantity: 273,
      calculated_net_sales_yen: 60_780,
    })
    expect(result.reports[0].lines.filter((line) => line.raw_product_name === 'ゴーヤー'))
      .toHaveLength(2)
  })

  it('normalizes product parentheses without merging varieties', () => {
    expect(normalizeProductName(' ヘリコニア（大） ')).toBe('ヘリコニア(大)')
    expect(normalizeProductName('紅芋（沖夢紫）')).not.toBe(normalizeProductName('紅芋（備瀬）'))
  })

  it('rejects a report whose stated total does not match its lines', () => {
    const result = parseSalesText(sample.replace('売 273 ￥60,780', '売 273 ￥60,781'), 2026)

    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NET_SALES_MISMATCH', reportDate: '2026-08-24' }),
    ]))
  })

  it('rejects impossible dates for the selected year', () => {
    const result = parseSalesText('02/29 18:30 売上状況', 2026)

    expect(result.isValid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_REPORT_DATE' }),
    ]))
  })

  it('supports extracted headers and discounted sales lines', () => {
    const extracted = `12:00\t販売通知\t"08/20 18:30 売上状況
県立農業大学校様
《やんばる市場》
オクラ
@100 売 2 値引 -50 値引数 1
★ 合 計 ★
売 2 ￥150"`
    const result = parseSalesText(extracted, 2026)

    expect(result.isValid).toBe(true)
    expect(result.reports[0]).toMatchObject({
      report_date: '2026-08-20',
      message_time: '12:00',
      sender_name: '販売通知',
      calculated_net_sales_yen: 150,
    })
    expect(result.reports[0].lines[0]).toMatchObject({
      discount_amount_yen: 50,
      discounted_quantity: 1,
    })
  })
})
