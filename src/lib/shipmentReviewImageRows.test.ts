import { describe, expect, it } from 'vitest'

import { shipmentReviewPhysicalRow } from './shipmentReviewImageRows'

describe('shipmentReviewPhysicalRow', () => {
  it('maps June pages across their confirmed blank row sections', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-02.jpg', 13)).toBe(20)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-03.jpg', 14)).toBe(20)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-04.jpg', 7)).toBe(10)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-07.jpg', 19)).toBe(30)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-09.jpg', 8)).toBe(30)
  })

  it('accounts for the excluded crossed-out row on page 01 for the June batch', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 9)).toBe(10)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 12)).toBe(14)
  })

  it('leaves page 01 rows outside the June correction as the identity mapping, for the 2026-05 batch reusing the same image', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 0)).toBe(0)
    expect(shipmentReviewPhysicalRow('スキャン_20260901-1655-01.jpg', 8)).toBe(8)
  })

  it('uses source_row for batches whose rows already identify physical image rows', () => {
    expect(shipmentReviewPhysicalRow('スキャン_20260829-0833-04.jpg', 23)).toBe(23)
  })
})
