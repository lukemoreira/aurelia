// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'

/** A question that wants a name: "Rename chapter", "New book". `run` throws a StorageError to say why not. */
export interface NameAsk {
  title: string
  description?: string
  confirm: string
  initial: string
  run: (name: string) => Promise<void>
}

/** What the author is told after an action: a line, and for a delete the way back. */
export interface Toast {
  text: string
  error?: boolean
  undo?: () => Promise<void>
  /** Move focus to Undo (the delete was made from the keyboard, where the row it had is gone). */
  focusUndo?: boolean
}

/** The outline editing's own UI state: the open questions, the list of deleted things, the toast. */
export const useEditsStore = defineStore('edits', () => {
  const ask = ref<NameAsk | null>(null)
  /** The scene being moved to a chapter (the dialog's subject). */
  const moving = ref<string | null>(null)
  const trashOpen = ref(false)
  const toast = ref<Toast | null>(null)
  /** Said to a screen reader, never shown: what a move did ("Moved “Gate” after “Arrival”"). */
  const announcement = ref('')
  async function announce(text: string) {
    announcement.value = '' // cleared first, so the same words twice are read twice
    await nextTick()
    announcement.value = text
  }
  return { ask, moving, trashOpen, toast, announcement, announce }
})
