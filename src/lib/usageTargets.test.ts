import { describe, expect, it } from 'vitest'

import { formatUsageTarget } from './usageTargets'

describe('usage target formatting', () => {
  it('shows the crop name for a resolved product target', () => {
    expect(formatUsageTarget('product', 'product-id', 'ゴーヤー')).toBe('product: ゴーヤー')
  })

  it('falls back to the target ID when a product name cannot be resolved', () => {
    expect(formatUsageTarget('product', 'product-id')).toBe('product: product-id')
  })

  it('preserves non-product targets and empty targets', () => {
    expect(formatUsageTarget('user', 'user-id')).toBe('user: user-id')
    expect(formatUsageTarget('page', null)).toBe('page')
    expect(formatUsageTarget(null, null)).toBe('—')
  })
})
