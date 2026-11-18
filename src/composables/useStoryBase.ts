// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import {
  BASE_SECTIONS,
  baseOf,
  bookCharacters,
  isBaseEmpty,
  type BaseSection,
} from '@/domain/story-base'
import { wordsFor } from '@/storage/errors'
import { setBaseSection } from '@/storage/story-base-actions'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAssistant } from './useAssistant'
import { useOutlineEdits } from './useOutlineEdits'

/**
 * The open book's story base (ADR-0016), edited by hand: each section saved when the author leaves it.
 * A section the files change under (another device, an accepted suggestion) follows, unless the author
 * has typed in it. Its characters are the world's Character records, listed here.
 */
export function useStoryBase() {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const layout = useLayoutStore()
  const assistant = useAssistant()
  const error = ref('')
  const stored = computed(() => baseOf(ws.data?.books.find((b) => b.id === ws.bookId)))
  const draft = reactive({ ...stored.value })
  const seen = reactive({ ...stored.value })
  watch(
    () => [ws.bookId, ...BASE_SECTIONS.map((s) => stored.value[s.key])],
    (_, old) => {
      const otherBook = old?.[0] !== ws.bookId
      for (const { key } of BASE_SECTIONS) {
        const now = stored.value[key]
        if (otherBook || draft[key] === seen[key]) draft[key] = now
        seen[key] = now
      }
    },
  )

  async function save(key: BaseSection) {
    const bookId = ws.bookId
    if (!ws.session || !bookId || draft[key] === stored.value[key]) return
    error.value = ''
    try {
      await setBaseSection(ws.session, bookId, key, draft[key])
    } catch (e) {
      error.value = wordsFor(e) // what was typed stays, to be tried again
    }
  }

  const characters = computed(() =>
    ws.data && ws.bookId ? bookCharacters(ws.data, ws.bookId) : [],
  )
  const empty = computed(() => !!ws.data && !!ws.bookId && isBaseEmpty(ws.data, ws.bookId))
  /** The assistant can guide when it is signed in and this workspace is synced with the server. */
  const canGuide = computed(() => assistant.state.value === 'signed-in' && !!assistant.folder.value)

  function guide() {
    layout.askAssistant()
    void assistant.guidedStart()
  }

  return {
    draft,
    error,
    readOnly: computed(() => !edit.canEdit.value),
    save,
    characters,
    empty,
    canGuide,
    guide,
  }
}
