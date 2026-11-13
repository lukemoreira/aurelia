// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import { chapterChoices } from '@/domain/outline-moves'
import { bookOf } from '@/storage/outline-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { titleOf, useOutlineEdits } from './useOutlineEdits'

/** "Move to chapter…": which chapters a scene can go to, the one picked, and the move. */
export function useMoveScene() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const edit = useOutlineEdits()
  const target = ref('')

  const scene = computed(() => ws.data?.scenes.find((s) => s.meta.id === edits.moving))
  const choices = computed(() => {
    const data = ws.data
    const book = data && edits.moving ? bookOf(data, edits.moving) : undefined
    return data && book
      ? chapterChoices(data, book).map((c) => ({
          value: c.id,
          label: c.id === scene.value?.meta.chapter ? `${c.label} (now)` : c.label,
        }))
      : []
  })
  const open = computed({
    get: () => !!edits.moving,
    set: (v: boolean) => {
      if (!v) edits.moving = null
    },
  })
  watch(
    () => edits.moving,
    (id) => {
      if (id)
        target.value = choices.value.find((c) => c.value !== scene.value?.meta.chapter)?.value ?? ''
    },
  )

  async function move() {
    const id = edits.moving
    if (id && target.value) await edit.moveToChapter(id, target.value)
    edits.moving = null
  }
  const title = computed(() =>
    ws.data && edits.moving ? `Move “${titleOf(ws.data, edits.moving)}”` : 'Move scene',
  )
  return { open, title, choices, target, move }
}
