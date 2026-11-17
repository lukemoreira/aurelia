// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch } from 'vue'
import type { MediaDoc } from '@/domain/workspace-data'
import { wordsFor } from '@/storage/errors'
import { importMedia } from '@/storage/media-actions'
import { MediaViewer } from '@/storage/media-viewer'
import { setDetails } from '@/storage/outline-actions'
import type { WorkspaceSession } from '@/storage/session'
import { opfsThumbStore } from '@/storage/thumbnails'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'

const viewers = new WeakMap<WorkspaceSession, MediaViewer>()

/** The one viewer of an open workspace: it keeps the pictures it has made, and goes with the session. */
function viewerOf(session: WorkspaceSession): MediaViewer {
  let v = viewers.get(session)
  if (!v) {
    v = new MediaViewer({
      readBytes: (path) => session.adapter.readBytes(path),
      workspaceId: session.data.workspace.id,
      thumbs: opfsThumbStore(),
    })
    viewers.set(session, v)
  }
  return v
}

/** The image a record or a card shows: an object URL of the file (or of its thumbnail), once it is read. */
export function useMediaImage(idOf: () => string | undefined, variant: 'thumb' | 'full' = 'thumb') {
  const ws = useWorkspaceStore()
  const doc = computed(() => ws.data?.media?.find((m) => m.meta.id === idOf()))
  const url = shallowRef<string | null>(null)
  const failed = ref(false)
  // Looks again when the image or the session changes, not when only its caption does.
  watch(
    [() => doc.value?.meta.id, () => doc.value?.meta.file, () => ws.session],
    async ([id, , session]) => {
      url.value = null
      failed.value = false
      const d = doc.value
      if (!d || !session) return
      const viewer = viewerOf(session)
      const got = await (variant === 'full' ? viewer.full(d) : viewer.thumb(d))
      // The answer may be for a picture that is no longer the one asked about.
      if (doc.value?.meta.id === id) [url.value, failed.value] = [got, got === null]
    },
    { immediate: true },
  )
  return { url, failed }
}

/** The media gallery: the images of this universe, importing, captions, and delete (to the trash). */
export function useMedia() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const edit = useOutlineEdits()
  const busy = ref<{ done: number; total: number } | null>(null)

  /** Newest first would shuffle the grid under the author's hand: by name, as the files were imported. */
  const items = computed<MediaDoc[]>(() =>
    (ws.data?.media ?? [])
      .filter((m) => m.universe === ws.universe?.id)
      .sort((a, b) => (a.meta.name ?? a.meta.file).localeCompare(b.meta.name ?? b.meta.file)),
  )

  /** Import these files one after another (each is read whole, then written, then checked). Returns the IDs made. */
  async function importFiles(files: File[]): Promise<string[]> {
    const session = ws.session
    const universe = ws.universe
    if (!session || !universe || !edit.canEdit.value || !files.length) return []
    const made: string[] = []
    const problems: string[] = []
    busy.value = { done: 0, total: files.length }
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        made.push(
          await importMedia(session, universe.id, { name: file.name, type: file.type, bytes }),
        )
      } catch (e) {
        problems.push(wordsFor(e, `“${file.name}” could not be added. Nothing was lost.`))
      }
      busy.value = { done: busy.value.done + 1, total: files.length }
    }
    busy.value = null
    // One line to say how many went in, then one problem per line.
    if (problems.length)
      edits.toast = {
        text: [
          made.length
            ? `Added ${made.length} of ${files.length} images.`
            : `Could not add ${files.length === 1 ? 'the image' : 'the images'}.`,
          ...problems,
        ].join('\n'),
        error: true,
      }
    else
      edits.toast = {
        text: files.length === 1 ? 'Added the image.' : `Added ${files.length} images.`,
      }
    return made
  }

  async function saveDetails(id: string, patch: { caption?: string; credit?: string }) {
    const session = ws.session
    if (!session) return
    const clean = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, v?.trim() ? v.trim() : undefined]),
    )
    try {
      await setDetails(session, id, clean)
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That could not be saved. Nothing was lost.'), error: true }
    }
  }

  async function remove(id: string) {
    const session = ws.session
    await edit.remove(id)
    if (session) await viewerOf(session).forget(id)
  }

  return {
    items,
    busy,
    canEdit: edit.canEdit,
    importFiles,
    saveDetails,
    remove,
  }
}
