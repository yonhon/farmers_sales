import { describe, expect, it } from 'vitest'

import { buildSalesHashHref, parseHashRoute } from './routes'

describe('application hash routes', () => {
  it('recognizes independent administrator routes', () => {
    expect(parseHashRoute('#/admin/users').isUserManagement).toBe(true)
    expect(parseHashRoute('#/admin/usage').isUsageAdmin).toBe(true)
    expect(parseHashRoute('#/sales/import').isImport).toBe(true)
  })

  it('round-trips product and date filters', () => {
    const href = buildSalesHashHref('青ねぎ', '2026-08-01', '2026-08-31')
    expect(parseHashRoute(href)).toMatchObject({
      productId: '青ねぎ',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
  })
})
