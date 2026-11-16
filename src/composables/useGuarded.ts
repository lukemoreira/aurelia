// SPDX-License-Identifier: AGPL-3.0-or-later
import { wordsFor } from '@/storage/errors'
import { useEditsStore } from '@/stores/edits'

/** Runs a change and, when it cannot be made, says why in a toast, in the author's words. */
export function useGuarded() {
  const edits = useEditsStore()
  return async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That did not work. Nothing was lost.'), error: true }
    }
  }
}
