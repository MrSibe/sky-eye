import { describe, expect, it } from 'vitest'
import { ByteLru } from './byteLru'

describe('ByteLru', () => {
  it('accounts exact bytes and evicts least recently used entries', () => {
    const cache = new ByteLru<string, string>(12)
    cache.set('a', 'A', 4)
    cache.set('b', 'B', 4)
    cache.get('a')
    expect(cache.set('c', 'C', 8)).toEqual(['b'])
    expect(cache.peek('a')).toBe('A')
    expect(cache.peek('c')).toBe('C')
    expect(cache.stats()).toMatchObject({ bytes: 12, entries: 2, evictions: 1 })
  })

  it('preserves protected and newly inserted frames, allowing one oversize frame', () => {
    const cache = new ByteLru<number, string>(8)
    cache.set(0, 'current', 4)
    cache.set(1, 'neighbor', 4)
    expect(cache.set(2, 'next', 12, new Set([0, 1]))).toEqual([])
    expect(cache.stats()).toMatchObject({ bytes: 20, entries: 3 })
    cache.set(3, 'later', 4, new Set([3]))
    expect(cache.peek(3)).toBe('later')
    expect(cache.stats().bytes).toBeLessThanOrEqual(8)
  })

  it('clears entries and diagnostics between sessions', () => {
    const cache = new ByteLru<number, string>(8)
    cache.set(0, 'a', 8)
    cache.set(1, 'b', 8)
    expect(cache.stats().evictions).toBe(1)
    cache.clear()
    expect(cache.stats()).toEqual({ bytes: 0, entries: 0, evictions: 0, maxBytes: 8 })
  })
})
