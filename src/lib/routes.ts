export type HashRoute = {
  productId: string | null
  isImport: boolean
  isUserManagement: boolean
  isUsageAdmin: boolean
  startDate: string
  endDate: string
}

export function parseHashRoute(hash: string): HashRoute {
  const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?')
  const match = path.match(/^\/products\/([^/]+)$/)
  const params = new URLSearchParams(query)
  return {
    productId: match ? decodeURIComponent(match[1]) : null,
    isImport: path === '/sales/import',
    isUserManagement: path === '/admin/users',
    isUsageAdmin: path === '/admin/usage',
    startDate: params.get('from') ?? '',
    endDate: params.get('to') ?? '',
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
