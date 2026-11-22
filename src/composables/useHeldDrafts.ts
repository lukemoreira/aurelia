// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive, shallowRef, watch, type Ref } from 'vue'
import type { Proposal } from '@/domain/proposals'

/** Suggestions the author accepted or dismissed (from any card or popup): their going is the author's own doing. */
const decided = new Set<string>()
/** For tests: forget who decided what. */
export const resetDecided = () => decided.clear()

/**
 * Suggestions the author is editing are never taken off screen with their text: one that disappears from
 * `all` meanwhile (replaced by a revision, cleared on another device) is held, shown as gone, until the
 * author lets their text go. One the author accepted or dismissed here goes as usual.
 */
export function useHeldDrafts(all: Ref<readonly Proposal[]>) {
  /** Suggestions whose card holds the author's unsaved text. */
  const dirty = reactive(new Set<string>())
  const held = shallowRef<Proposal[]>([])
  const listed = (id: string) => all.value.some((p) => p.id === id)

  watch(all, (now, before) => {
    const ids = new Set(now.map((p) => p.id))
    const gone = (before ?? []).filter(
      (p) => !ids.has(p.id) && dirty.has(p.id) && !decided.has(p.id),
    )
    held.value = [
      ...held.value.filter((p) => !ids.has(p.id) && dirty.has(p.id)),
      ...gone.filter((p) => !held.value.some((h) => h.id === p.id)),
    ]
  })

  /** The card of `id` holds unsaved text (`true`), or no longer does: then a held one goes. */
  function setDirty(id: string, on: boolean) {
    if (on) dirty.add(id)
    else {
      dirty.delete(id)
      held.value = held.value.filter((p) => p.id !== id)
    }
  }

  /** Run the author's Accept or Dismiss: if it takes the suggestion away, nothing is held. */
  async function decide(id: string, work: () => Promise<unknown>) {
    decided.add(id)
    try {
      await work()
    } finally {
      if (listed(id)) decided.delete(id)
    }
  }

  return { held, setDirty, decide, isGone: (id: string) => !listed(id) }
}
