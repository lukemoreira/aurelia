// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch } from 'vue'
import { wordsFor } from '@/storage/errors'
import { restoreBook, restoreScene } from '@/storage/snapshot-restore'
import { bookRestoreWords, sceneRestoreWords } from '@/storage/snapshot-words'
import {
  listSnapshots,
  takeSnapshot,
  type Snapshot,
  type SnapshotTarget,
} from '@/storage/snapshots'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

/** Ticks when a snapshot is made or a restore is done, so every list on screen looks again. */
const changed = ref(0)

/** Take a snapshot and say so in a toast. The one door for the buttons and the palette. */
export async function takeWithToast(target: SnapshotTarget, name?: string): Promise<boolean> {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  if (!ws.session) return false
  try {
    const snap = await takeSnapshot(ws.session, target, { name })
    changed.value++
    edits.toast = {
      text: `Snapshot of “${snap.title}” saved. It is in History.`,
    }
    return true
  } catch (e) {
    edits.toast = {
      text: wordsFor(e, 'The snapshot could not be made. Nothing was changed.'),
      error: true,
    }
    return false
  }
}

/**
 * The snapshots of a scene (its own, and the book snapshots that hold it) or of a book, newest
 * first, with Take and Restore. Looks again when it is shown and after any change.
 */
export function useHistory(target: () => SnapshotTarget | undefined) {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const all = shallowRef<Snapshot[]>([])
  const busy = ref<'take' | 'restore' | null>(null)
  const error = ref('')
  /** The words after a restore, shown beside the list until the next action. */
  const outcome = ref('')
  /** The list has been read once: before that "no snapshots" would be a guess. */
  const loaded = ref(false)

  const snapshots = computed(() => {
    const t = target()
    if (!t) return []
    return all.value.filter((s) =>
      t.kind === 'book'
        ? s.kind === 'book' && s.target === t.id
        : (s.kind === 'scene' && s.target === t.id) ||
          (s.kind === 'book' && s.files.some((f) => f.path.endsWith(`/${t.id}.md`))),
    )
  })

  async function refresh() {
    if (!ws.session) return void ((all.value = []), (loaded.value = true))
    try {
      all.value = await listSnapshots(ws.session.adapter)
    } catch (e) {
      error.value = wordsFor(e, 'The snapshots could not be listed.')
    } finally {
      loaded.value = true
    }
  }
  watch([() => ws.session, () => changed.value, () => target()?.id], refresh, { immediate: true })

  /** Run a change, and say why in words when it cannot be made. */
  async function guarded(kind: 'take' | 'restore', work: () => Promise<void>) {
    busy.value = kind
    error.value = outcome.value = ''
    try {
      await work()
    } catch (e) {
      error.value = wordsFor(e, 'That did not work. Nothing was lost.')
    } finally {
      busy.value = null
      changed.value++
    }
  }

  const take = (name?: string) =>
    guarded('take', async () => {
      const t = target()
      if (!ws.session || !t) return
      const snap = await takeSnapshot(ws.session, t, { name })
      edits.toast = { text: `Snapshot of “${snap.title}” saved.` }
    })

  /** Put a snapshot back: a scene from its own or from a book's, or a whole book. */
  const restore = (snap: Snapshot) =>
    guarded('restore', async () => {
      const t = target()
      if (!ws.session || !t) return
      if (t.kind === 'scene')
        outcome.value = sceneRestoreWords(await restoreScene(ws.session, snap.id, t.id))
      else outcome.value = bookRestoreWords(await restoreBook(ws.session, snap.id))
    })

  return {
    snapshots,
    all,
    busy,
    error,
    outcome,
    loaded,
    take,
    restore,
    refresh,
    canWrite: computed(() => !!ws.view && !ws.view.readOnly),
  }
}
