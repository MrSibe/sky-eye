export interface ByteLruStats {
  bytes: number
  entries: number
  evictions: number
  maxBytes: number
}

interface Entry<V> {
  value: V
  bytes: number
}

export class ByteLru<K, V> {
  private readonly entries = new Map<K, Entry<V>>()
  private usedBytes = 0
  private evictionCount = 0

  constructor(readonly maxBytes: number) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  peek(key: K): V | undefined {
    return this.entries.get(key)?.value
  }

  set(key: K, value: V, bytes: number, protectedKeys: ReadonlySet<K> = new Set()): K[] {
    const previous = this.entries.get(key)
    if (previous) {
      this.usedBytes -= previous.bytes
      this.entries.delete(key)
    }
    this.entries.set(key, { value, bytes })
    this.usedBytes += bytes

    const evicted: K[] = []
    while (this.usedBytes > this.maxBytes && this.entries.size > 1) {
      const candidate = this.entries.keys().next().value as K | undefined
      if (candidate === undefined) break
      if (candidate === key || protectedKeys.has(candidate)) {
        const entry = this.entries.get(candidate)
        if (!entry) break
        this.entries.delete(candidate)
        this.entries.set(candidate, entry)
        if ([...this.entries.keys()].every((item) => item === key || protectedKeys.has(item))) break
        continue
      }
      this.delete(candidate)
      this.evictionCount += 1
      evicted.push(candidate)
    }
    return evicted
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.usedBytes -= entry.bytes
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.usedBytes = 0
    this.evictionCount = 0
  }

  stats(): ByteLruStats {
    return {
      bytes: this.usedBytes,
      entries: this.entries.size,
      evictions: this.evictionCount,
      maxBytes: this.maxBytes,
    }
  }
}
