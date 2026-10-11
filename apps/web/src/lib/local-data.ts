/** Remove what this app keeps in `storage`: every key it writes is `dd-` prefixed. */
export function clearLocalData(storage: Storage = localStorage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (k): k is string => !!k && k.startsWith('dd-'),
  )
  for (const key of keys) storage.removeItem(key)
}
