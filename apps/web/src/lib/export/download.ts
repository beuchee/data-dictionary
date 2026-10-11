/** Saves `content` as a file through a temporary object URL (browser only). */
export function downloadText(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next task: some browsers cancel a download whose URL is revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
