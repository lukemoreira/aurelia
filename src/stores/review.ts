// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * "Review" on a name Aurelia is asking about (the Names tab): the open scene's editor takes the caret
 * to the first such place, so the question opens where the word is. The editor clears it once it has.
 */
export const useReviewStore = defineStore('review', () => {
  const name = ref<string | null>(null)
  /** A search result opened at its words: the file with this ID selects the first place `term` is written. */
  const found = ref<{ id: string; term: string } | null>(null)
  return { name, found }
})
