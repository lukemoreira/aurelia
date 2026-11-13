// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref } from 'vue'
import { wordsFor } from '@/storage/errors'
import { useWorkspaceStore } from '@/stores/workspace'

/** Save a blob through the browser, as a download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** "Download a copy (.zip)": every file of the open workspace, saved through the browser. */
export function useDownloadCopy() {
  const ws = useWorkspaceStore()
  const busy = ref(false)
  const error = ref('')

  async function download() {
    const session = ws.session
    if (!session) return
    busy.value = true
    error.value = ''
    try {
      const blob = await session.exportZip()
      saveBlob(
        blob,
        `${session.data.workspace.name.replace(/[\\/:*?"<>|]+/g, '-')} ${new Date().toLocaleDateString('en-CA')}.zip`,
      )
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not make the copy.')
    } finally {
      busy.value = false
    }
  }
  return { download, busy, error }
}
