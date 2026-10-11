import { describe, expect, it } from 'vitest'
import { clearLocalData } from './local-data'

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe('clearLocalData', () => {
  it('removes only the app’s dd- keys', () => {
    const storage = memoryStorage({ 'dd-access-token': 'a', 'dd-preferences': 'b', 'other-app': 'c', indicate_reviews: 'd' })
    clearLocalData(storage)
    expect([storage.key(0), storage.key(1), storage.length]).toEqual(['other-app', 'indicate_reviews', 2])
  })
})
