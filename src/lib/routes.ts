export type HashRoute = {
  productId: string | null
  isImport: boolean
  isUserManagement: boolean
  isUsageAdmin: boolean
  startDate: string
  endDate: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function parseHashRoute(hash: string): HashRoute {
  const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?')
  const match = path.match(/^\/products\/([^/]+)$/)
  const params = new URLSearchParams(query)
  const decodedProductId = match ? decodePathSegment(match[1]) : null
  let startDate = params.get('from') ?? ''
  let endDate = params.get('to') ?? ''
  startDate = isIsoDate(startDate) ? startDate : ''
  endDate = isIsoDate(endDate) ? endDate : ''
  if (startDate && endDate && startDate > endDate) {
    startDate = ''
    endDate = ''
  }
  const hasValidProductRoute = decodedProductId !== null
    && UUID_PATTERN.test(decodedProductId)
    && Boolean(startDate)
    && Boolean(endDate)

  return {
    productId: hasValidProductRoute ? decodedProductId : null,
    isImport: path === '/sales/import',
    isUserManagement: path === '/admin/users',
    isUsageAdmin: path === '/admin/usage',
    startDate,
    endDate,
  }
}

export function buildSalesHashHref(productId: string | null, startDate: string, endDate: string) {
  const params = new URLSearchParams()
  if (startDate) params.set('from', startDate)
  if (endDate) params.set('to', endDate)
  const path = productId ? `/products/${encodeURIComponent(productId)}` : '/'
  const query = params.toString()
  return `#${path}${query ? `?${query}` : ''}`
}
