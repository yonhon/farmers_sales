import { describe, expect, it } from 'vitest'

import { mergeSourceImageUrls } from './shipmentReviewImages'

const file = (name: string, type = 'image/jpeg') => ({ name, type })

describe('mergeSourceImageUrls', () => {
  it('adds a second selection to the images that are already loaded', () => {
    const revoked: string[] = []
    const create = (item: { name: string }) => `blob:${item.name}`
    const first = mergeSourceImageUrls({}, [file('a.jpg'), file('b.jpg')], create, (url) => revoked.push(url))
    const second = mergeSourceImageUrls(first.urls, [file('c.jpg')], create, (url) => revoked.push(url))

    expect(Object.keys(second.urls)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(second.added).toBe(1)
    expect(revoked).toEqual([])
  })

  it('replaces only the file that has the same name and releases its old URL', () => {
    const revoked: string[] = []
    let counter = 0
    const create = (item: { name: string }) => `blob:${item.name}:${counter += 1}`
    const first = mergeSourceImageUrls({}, [file('a.jpg'), file('b.jpg')], create, (url) => revoked.push(url))
    const second = mergeSourceImageUrls(first.urls, [file('b.jpg')], create, (url) => revoked.push(url))

    expect(second.urls['a.jpg']).toBe(first.urls['a.jpg'])
    expect(second.urls['b.jpg']).not.toBe(first.urls['b.jpg'])
    expect(revoked).toEqual([first.urls['b.jpg']])
  })

  it('ignores non-image files and keeps the loaded set when nothing is added', () => {
    const current = { 'a.jpg': 'blob:a' }
    const result = mergeSourceImageUrls(current, [file('notes.txt', 'text/plain')], () => 'blob:x', () => {})

    expect(result.urls).toBe(current)
    expect(result.added).toBe(0)
  })
})
