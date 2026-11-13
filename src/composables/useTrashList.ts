// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, watch } from 'vue'
import { wordsFor } from '@/storage/errors'
import { restoreDeleted } from '@/storage/outline-actions'
import { listTrash, type TrashEntry } from '@/storage/set-aside'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

/** The "Recently deleted" list: what is waiting in the trash, and putting it back. */
export function useTrashList() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const entries = ref<TrashEntry[]>([])
  const loading = ref(false)
  const busy = ref('')
  const error = ref('')

  async function load() {
    const session = ws.session
    if (!session) return
    loading.value = true
    try {
      entries.value = await listTrash(session.adapter)
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not read the list of deleted things.')
    } finally {
      loading.value = false
    }
  }
  watch(
    () => edits.trashOpen,
    (open) => {
      if (!open) return
      error.value = ''
      void load()
    },
  )

  async function restore(stamp: string) {
    const session = ws.session
    if (!session || busy.value) return
    busy.value = stamp
    error.value = ''
    try {
      const result = await restoreDeleted(session, stamp)
      if (result.skipped.length)
        error.value =
          'Part of it could not come back, because something else is in its place. It stays in the list.'
      await load()
    } catch (e) {
      error.value = wordsFor(e, 'That did not come back. It is still in the list.')
    } finally {
      busy.value = ''
    }
  }

  return { entries, loading, busy, error, restore }
}
