// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import { wordsFor } from '@/storage/errors'
import { checkWorkspaceName } from '@/storage/create'
import { renameBlock } from '@/storage/status'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

/** Why "Rename workspace…" is not available, or null; also null for the sample, which has no such command. */
export function useRenameReason() {
  const ws = useWorkspaceStore()
  return computed(() => (ws.view ? renameBlock(ws.view) : null))
}

/** The Rename workspace dialog: the name being typed, whether it may be saved, and the save. */
export function useRenameWorkspace() {
  const ws = useWorkspaceStore()
  const layout = useLayoutStore()
  const name = ref('')
  const busy = ref(false)
  const failure = ref('')

  watch(
    () => layout.renameOpen,
    (open) => {
      if (!open) return
      name.value = ws.view?.name ?? ''
      failure.value = ''
    },
  )

  const checked = computed(() => checkWorkspaceName(name.value))
  const error = computed(() => checked.value.error)
  const ready = computed(() => checked.value.ok && checked.value.name !== ws.view?.name)

  async function save() {
    if (!ready.value || busy.value) return
    busy.value = true
    failure.value = ''
    try {
      await ws.renameWorkspace(name.value)
      layout.renameOpen = false
    } catch (e) {
      failure.value = wordsFor(e, 'Aurelia could not change the name. Nothing was lost.')
    } finally {
      busy.value = false
    }
  }

  return { name, error, failure, ready, busy, save }
}
