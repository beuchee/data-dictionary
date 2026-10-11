import { useState } from 'react'

/** Selected row indices of a units table; cleared whenever edit mode turns on or off. */
export function useRowSelection(editing: boolean) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    setSelected(new Set())
  }
  return {
    selected: selected as ReadonlySet<number>,
    toggle: (index: number) =>
      setSelected((s) => {
        const next = new Set(s)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      }),
    selectAll: (count: number) => setSelected(new Set(Array.from({ length: count }, (_, i) => i))),
    clear: () => setSelected(new Set()),
  }
}
