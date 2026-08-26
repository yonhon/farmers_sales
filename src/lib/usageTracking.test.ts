import { describe, expect, it } from 'vitest'

import { findTopUsageUsers, sanitizeUsageMessage } from './usageTracking'

describe('usage tracking helpers', () => {
  it('sanitizes URLs, whitespace, and long error messages', () => {
    const result = sanitizeUsageMessage(`Request failed\nhttps://example.test/private?token=secret ${'x'.repeat(240)}`)
    expect(result).not.toContain('token=secret')
    expect(result).toContain('[url]')
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('ranks users by total page views across rows', () => {
    const result = findTopUsageUsers([
      { user_id: 'a', display_name: 'Aさん', pv: 2 },
      { user_id: 'b', display_name: 'Bさん', pv: 5 },
      { user_id: 'a', display_name: 'Aさん', pv: 4 },
      { user_id: null, display_name: '削除済み', pv: 20 },
    ])

    expect(result).toEqual([
      { userId: 'a', displayName: 'Aさん', pv: 6 },
      { userId: 'b', displayName: 'Bさん', pv: 5 },
    ])
  })
})
