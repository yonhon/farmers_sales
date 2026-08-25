export type ImportIssue = {
  severity: 'warning' | 'error'
  code: string
  message: string
  sourceLineNumber?: number
  reportDate?: string
}

export type ParsedSalesLine = {
  line_sequence: number
  raw_product_name: string
  normalized_product_name: string
  unit_price_yen: number
  sold_quantity: number
  discount_amount_yen: number
  discounted_quantity: number
  gross_sales_yen: number
  net_sales_yen: number
  source_line_number: number
}

export type ParsedSalesReport = {
  report_date: string
  report_time: string
  message_time: string
  sender_name: string
  recipient_name: string
  market_name: string
  reported_sold_quantity: number | null
  reported_net_sales_yen: number | null
  calculated_sold_quantity: number
  calculated_net_sales_yen: number
  source_start_line: number
  lines: ParsedSalesLine[]
  isValid: boolean
}

export type ParseSalesResult = {
  reports: ParsedSalesReport[]
  issues: ImportIssue[]
  reportCount: number
  lineCount: number
  soldQuantity: number
  netSalesYen: number
  isValid: boolean
}

type WorkingReport = Omit<
  ParsedSalesReport,
  'calculated_sold_quantity' | 'calculated_net_sales_yen' | 'isValid'
> & {
  currentProductName: string | null
}

const SIMPLE_HEADER_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\s+売上状況$/
const EXTRACTED_HEADER_RE = /^(\d{1,2}:\d{2})\t+([^\t]+?)\t+(?:"\s*)?(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\s+売上状況$/
const MARKET_RE = /^《(.+)》$/
const DETAIL_RE = /^@([\d,]+)\s+売\s+(\d+)(?:\s+値引\s+-([\d,]+)\s+値引数\s+(\d+))?\s*"?$/
const TOTAL_RE = /^売\s+(\d+)\s+[￥¥]([\d,]+)\s*"?$/
const TOTAL_MARKER_RE = /^★\s*合\s*計\s*★$/

export function normalizeProductName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^"|"$/g, '')
}

function normalizeInputLine(value: string) {
  return value
    .replace(/&#x20;|&nbsp;/gi, ' ')
    .trim()
    .replace(/\\$/, '')
    .trim()
    .replace(/^\uFEFF/, '')
}

function parseInteger(value: string) {
  return Number.parseInt(value.replace(/,/g, ''), 10)
}

function buildDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function issue(
  severity: ImportIssue['severity'],
  code: string,
  message: string,
  sourceLineNumber?: number,
  reportDate?: string,
): ImportIssue {
  return { severity, code, message, sourceLineNumber, reportDate }
}

export function parseSalesText(content: string, reportYear: number): ParseSalesResult {
  const reports: ParsedSalesReport[] = []
  const issues: ImportIssue[] = []
  let current: WorkingReport | null = null
  let seenTotalMarker = false

  function finishCurrent() {
    if (!current) return
    const working = current
    const calculatedQuantity = working.lines.reduce(
      (total, line) => total + line.sold_quantity,
      0,
    )
    const calculatedNetSales = working.lines.reduce(
      (total, line) => total + line.net_sales_yen,
      0,
    )
    let isValid = true

    if (!working.market_name) {
      isValid = false
      issues.push(issue('error', 'MISSING_MARKET', '市場名がありません。', working.source_start_line, working.report_date))
    }
    if (!working.lines.length) {
      isValid = false
      issues.push(issue('error', 'MISSING_SALES_LINES', '商品明細がありません。', working.source_start_line, working.report_date))
    }
    if (working.reported_sold_quantity === null || working.reported_net_sales_yen === null) {
      isValid = false
      issues.push(issue('error', 'MISSING_DAILY_TOTAL', '日別合計がありません。', working.source_start_line, working.report_date))
    } else {
      if (calculatedQuantity !== working.reported_sold_quantity) {
        isValid = false
        issues.push(issue(
          'error',
          'SOLD_QUANTITY_MISMATCH',
          `販売個数が一致しません（報告 ${working.reported_sold_quantity}、計算 ${calculatedQuantity}）。`,
          working.source_start_line,
          working.report_date,
        ))
      }
      if (calculatedNetSales !== working.reported_net_sales_yen) {
        isValid = false
        issues.push(issue(
          'error',
          'NET_SALES_MISMATCH',
          `売上が一致しません（報告 ${working.reported_net_sales_yen}円、計算 ${calculatedNetSales}円）。`,
          working.source_start_line,
          working.report_date,
        ))
      }
    }

    const { currentProductName: _currentProductName, ...report } = working
    void _currentProductName
    reports.push({
      ...report,
      calculated_sold_quantity: calculatedQuantity,
      calculated_net_sales_yen: calculatedNetSales,
      isValid,
    })
    current = null
    seenTotalMarker = false
  }

  const rawLines = content.replace(/\r\n?/g, '\n').split('\n')
  rawLines.forEach((rawLine, index) => {
    const sourceLineNumber = index + 1
    const line = normalizeInputLine(rawLine)
    if (!line || line === '"') return

    const simpleHeader = SIMPLE_HEADER_RE.exec(line)
    const extractedHeader = EXTRACTED_HEADER_RE.exec(line)
    if (simpleHeader || extractedHeader) {
      finishCurrent()
      const month = Number(simpleHeader?.[1] ?? extractedHeader?.[3])
      const day = Number(simpleHeader?.[2] ?? extractedHeader?.[4])
      const reportDate = buildDate(reportYear, month, day)
      if (!reportDate) {
        issues.push(issue('error', 'INVALID_REPORT_DATE', `存在しない日付です：${month}/${day}`, sourceLineNumber))
        return
      }
      current = {
        report_date: reportDate,
        report_time: simpleHeader?.[3] ?? extractedHeader?.[5] ?? '',
        message_time: extractedHeader?.[1] ?? '',
        sender_name: normalizeProductName(extractedHeader?.[2] ?? ''),
        recipient_name: '',
        market_name: '',
        reported_sold_quantity: null,
        reported_net_sales_yen: null,
        source_start_line: sourceLineNumber,
        lines: [],
        currentProductName: null,
      }
      return
    }

    if (!current) {
      issues.push(issue('warning', 'CONTENT_OUTSIDE_REPORT', '売上報告の外にある内容を無視しました。', sourceLineNumber))
      return
    }

    const marketMatch = MARKET_RE.exec(line)
    if (marketMatch) {
      current.market_name = normalizeProductName(marketMatch[1])
      return
    }

    if (!current.market_name && !current.recipient_name) {
      current.recipient_name = normalizeProductName(line.replace(/様$/, ''))
      return
    }

    if (TOTAL_MARKER_RE.test(line)) {
      seenTotalMarker = true
      current.currentProductName = null
      return
    }

    const totalMatch = TOTAL_RE.exec(line)
    if (totalMatch) {
      current.reported_sold_quantity = parseInteger(totalMatch[1])
      current.reported_net_sales_yen = parseInteger(totalMatch[2])
      return
    }

    const detailMatch = DETAIL_RE.exec(line)
    if (detailMatch) {
      if (!current.currentProductName) {
        issues.push(issue('error', 'DETAIL_WITHOUT_PRODUCT', '販売明細の直前に商品名がありません。', sourceLineNumber, current.report_date))
        return
      }
      const unitPrice = parseInteger(detailMatch[1])
      const soldQuantity = parseInteger(detailMatch[2])
      const discountAmount = parseInteger(detailMatch[3] ?? '0')
      const discountedQuantity = parseInteger(detailMatch[4] ?? '0')
      if (discountedQuantity > soldQuantity) {
        issues.push(issue('error', 'DISCOUNT_QUANTITY_EXCEEDS_SALES', '値引数が販売個数を超えています。', sourceLineNumber, current.report_date))
      }
      const rawProductName = current.currentProductName
      current.lines.push({
        line_sequence: current.lines.length + 1,
        raw_product_name: rawProductName,
        normalized_product_name: normalizeProductName(rawProductName),
        unit_price_yen: unitPrice,
        sold_quantity: soldQuantity,
        discount_amount_yen: discountAmount,
        discounted_quantity: discountedQuantity,
        gross_sales_yen: unitPrice * soldQuantity,
        net_sales_yen: unitPrice * soldQuantity - discountAmount,
        source_line_number: sourceLineNumber,
      })
      return
    }

    if (line.startsWith('@')) {
      issues.push(issue('error', 'MALFORMED_SALES_DETAIL', '販売明細を解析できません。', sourceLineNumber, current.report_date))
      return
    }

    if (line.startsWith('売 ') || seenTotalMarker) {
      issues.push(issue('warning', 'CONTENT_AFTER_TOTAL_MARKER', '日別合計付近の予期しない内容を無視しました。', sourceLineNumber, current.report_date))
      return
    }

    current.currentProductName = line.replace(/^"|"$/g, '')
  })

  finishCurrent()

  const dates = new Set<string>()
  for (const report of reports) {
    if (dates.has(report.report_date)) {
      report.isValid = false
      issues.push(issue('error', 'DUPLICATE_REPORT_DATE', '貼り付け内容に同じ日付が複数あります。', report.source_start_line, report.report_date))
    }
    dates.add(report.report_date)
  }
  if (!reports.length) {
    issues.push(issue('error', 'NO_REPORTS', '売上状況を1件も解析できませんでした。'))
  }

  const lineCount = reports.reduce((total, report) => total + report.lines.length, 0)
  const soldQuantity = reports.reduce((total, report) => total + report.calculated_sold_quantity, 0)
  const netSalesYen = reports.reduce((total, report) => total + report.calculated_net_sales_yen, 0)
  const hasErrors = issues.some((item) => item.severity === 'error')

  return {
    reports,
    issues,
    reportCount: reports.length,
    lineCount,
    soldQuantity,
    netSalesYen,
    isValid: !hasErrors && reports.every((report) => report.isValid),
  }
}

export async function hashSalesSource(reportYear: number, content: string) {
  const bytes = new TextEncoder().encode(`${reportYear}\n${content.replace(/\r\n?/g, '\n').trim()}\n`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
