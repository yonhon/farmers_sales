import { describe, expect, it } from 'vitest'

import { shipmentReviewPhysicalRow } from './shipmentReviewImageRows'

describe('shipmentReviewPhysicalRow', () => {
  it('maps June pages across their confirmed blank row sections', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-02.jpg', 13, 13)).toBe(20)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-03.jpg', 14, 14)).toBe(20)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-04.jpg', 7, 7)).toBe(10)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-07.jpg', 19, 19)).toBe(30)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-09.jpg', 8, 8)).toBe(30)
  })

  it('accounts for the excluded crossed-out row on page 01', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 9, 0)).toBe(10)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 12, 3)).toBe(14)
  })

  it('uses source_row for batches whose rows already identify physical image rows', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260829-0833-04.jpg', 23, 4)).toBe(23)
  })
})

