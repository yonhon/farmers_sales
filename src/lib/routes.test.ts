import { describe, expect, it } from 'vitest'

import { buildSalesHashHref, parseHashRoute } from './routes'

describe('application hash routes', () => {
  it('recognizes independent administrator routes', () => {
    expect(parseHashRoute('#/admin/users').isUserManagement).toBe(true)
    expect(parseHashRoute('#/admin/usage').isUsageAdmin).toBe(true)
    expect(parseHashRoute('#/sales/import').isImport).toBe(true)
    expect(parseHashRoute('#/shipments/review').isShipmentReview).toBe(true)
  })

  it('round-trips product and date filters', () => {
    const productId = '550e8400-e29b-41d4-a716-446655440000'
    const href = buildSalesHashHref(productId, '2026-08-01', '2026-08-31')
    expect(parseHashRoute(href)).toMatchObject({
      productId,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
  })

  it('rejects malformed or non-UUID product paths without throwing', () => {
    expect(() => parseHashRoute('#/products/%E0%A4%A')).not.toThrow()
    expect(parseHashRoute('#/products/%E0%A4%A').productId).toBeNull()
    expect(parseHashRoute('#/products/not-a-uuid').productId).toBeNull()
  })

  it('rejects invalid product date ranges', () => {
    const productPath = '#/products/550e8400-e29b-41d4-a716-446655440000'

    expect(parseHashRoute(`${productPath}?from=bad&to=2026-08-31`)).toMatchObject({
      productId: null,
      startDate: '',
      endDate: '2026-08-31',
    })
    expect(parseHashRoute(`${productPath}?from=2026-02-30&to=2026-03-01`)).toMatchObject({
      productId: null,
      startDate: '',
      endDate: '2026-03-01',
    })
    expect(parseHashRoute(`${productPath}?from=2026-09-01&to=2026-08-31`)).toMatchObject({
      productId: null,
      startDate: '',
      endDate: '',
    })
  })
})
