// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import type { Alias } from '@/domain/schema/record'

/** A question that wants a name: "Rename chapter", "New book". `run` throws a StorageError to say why not. */
export interface NameAsk {
  title: string
  description?: string
  confirm: string
  initial: string
  /** Ask too whether the book is a branching story (the new-book question). */
  offerBranching?: boolean
  run: (name: string, branching?: boolean) => Promise<void>
}

/** A record was just renamed: its old names, so the text can be offered the same change (Rename everywhere). */
export interface RenameOffer {
  recordId: string
  before: { title: string; aliases: Alias[] }
}

/** What the author is told after an action: a line, and for a delete the way back. */
export interface Toast {
  text: string
  error?: boolean
  undo?: () => Promise<void>
  /** One more thing to do with what was just made ("Open"). */
  action?: { label: string; run: () => void }
  /** Move focus to Undo (the delete was made from the keyboard, where the row it had is gone). */
  focusUndo?: boolean
}

/** The outline editing's own UI state: the open questions, the list of deleted things, the toast. */
export const useEditsStore = defineStore('edits', () => {
  const ask = ref<NameAsk | null>(null)
  /** The scene being moved to a chapter (the dialog's subject). */
  const moving = ref<string | null>(null)
  const trashOpen = ref(false)
  /** Set after a record is renamed; the Rename everywhere dialog takes it up once the name dialog is gone. */
  const renameOffer = ref<RenameOffer | null>(null)
  const toast = ref<Toast | null>(null)
  /** Said to a screen reader, never shown: what a move did ("Moved “Gate” after “Arrival”"). */
  const announcement = ref('')
  async function announce(text: string) {
    announcement.value = '' // cleared first, so the same words twice are read twice
    await nextTick()
    announcement.value = text
  }
  return { ask, moving, trashOpen, renameOffer, toast, announcement, announce }
})
