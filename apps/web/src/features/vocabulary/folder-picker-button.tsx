import { useRef, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FolderPickerButtonProps {
  /** `name` is the folder's name; `files` every file in it (and one level below). */
  onPicked: (name: string, files: File[]) => void
  onError?: (error: unknown) => void
  disabled?: boolean
  children: ReactNode
}

interface DirectoryEntry {
  kind: 'file' | 'directory'
  name: string
  getFile?: () => Promise<File>
  values?: () => AsyncIterable<DirectoryEntry>
}

async function listDirectory(dir: DirectoryEntry, depth = 0): Promise<File[]> {
  const files: File[] = []
  for await (const entry of dir.values?.() ?? []) {
    if (entry.kind === 'file' && entry.getFile) files.push(await entry.getFile())
    else if (entry.kind === 'directory' && depth < 1) files.push(...(await listDirectory(entry, depth + 1)))
  }
  return files
}

/**
 * Pick a folder: `showDirectoryPicker` where the browser has it (Chrome, Edge),
 * else an `<input webkitdirectory>` (Firefox, Safari), as v1 did.
 */
export function FolderPickerButton({ onPicked, onError, disabled, children }: FolderPickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirectoryEntry> })
      .showDirectoryPicker
    if (!picker) {
      inputRef.current?.click()
      return
    }
    try {
      const dir = await picker({ mode: 'read' })
      onPicked(dir.name, await listDirectory(dir))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      onError?.(error)
    }
  }

  const handleInput = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    const folder = files[0].webkitRelativePath.split('/')[0] || files[0].name
    onPicked(folder, files)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={handleClick}>
        <FolderOpen size={14} />
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        // Not in React's typings: lets the input pick a folder.
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(e) => handleInput(e.target.files)}
      />
    </>
  )
}
