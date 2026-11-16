// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, inject, onBeforeUnmount, shallowRef } from 'vue'
import { routerKey } from 'vue-router'
import type { CardView, LinkEnv, PickerView } from '@/editor/link-env'
import { cardAnnouncement } from '@/components/write/card-words'
import { useWorkspaceStore } from '@/stores/workspace'
import { altLabel, modLabel } from './useKeyboardShortcuts'
import { useNavigation } from './useNavigation'
import { useNotAName } from './useSceneNames'

/** How long a card waits for the pointer to cross the gap to it. */
const LINGER_MS = 220

/**
 * What the editor on one scene (or record's notes) needs to know links and names: the index of the
 * open workspace, seen from that file's book, and the card and picker the screen draws. `names:
 * false` is for notes, where links count and names are not looked for.
 */
export function useLinkEnv(docId: () => string | undefined, opts: { names: boolean }) {
  const ws = useWorkspaceStore()
  const notAName = useNotAName()
  // Without a router (a bare editor in a test) there is nowhere to open a link to.
  const nav = inject(routerKey, null) ? useNavigation() : null
  const card = shallowRef<CardView | null>(null)
  const picker = shallowRef<PickerView | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let focusCard: (() => boolean) | undefined
  onBeforeUnmount(() => clearTimeout(timer))

  const scope = () => {
    const id = docId()
    return id ? ws.index.scope(id) : undefined
  }
  const ignored = () =>
    new Set(ws.data?.scenes.find((s) => s.meta.id === docId())?.meta.ignoreNames ?? [])

  const env: LinkEnv = {
    analyse(text) {
      const where = scope()
      if (!where) return null
      const found = ws.index.analyseText(text, where, ignored())
      return opts.names ? found : { ...found, mentions: [] }
    },
    pick: (query) => {
      const where = scope()
      return where ? ws.index.pick(query, where) : []
    },
    writable: () => !!ws.session && !ws.view?.readOnly,
    target: (id) => ws.index.targetOf(id),
    open: (target) => void nav?.openTarget(target),
    notAName(key) {
      const id = docId()
      if (id) void notAName(id, [key])
      card.value = null
    },
    card: {
      show(view) {
        clearTimeout(timer)
        card.value = view
      },
      leave() {
        clearTimeout(timer)
        timer = setTimeout(() => (card.value = null), LINGER_MS)
      },
      close() {
        clearTimeout(timer)
        const was = card.value !== null
        card.value = null
        return was
      },
      focus: () => focusCard?.() ?? false,
    },
    picker: {
      show: (view) => (picker.value = view),
      hide: () => (picker.value = null),
    },
  }

  return {
    env,
    card,
    picker,
    /** What a screen reader is told when a card opens (the card itself never takes focus). */
    announcement: computed(() =>
      cardAnnouncement(card.value, { answer: `${altLabel} Down`, open: `${modLabel} Enter` }),
    ),
    /** The pointer is on the card: it stays. */
    holdCard: () => clearTimeout(timer),
    leaveCard: env.card.leave,
    closeCard: env.card.close,
    /** The card component says how the keyboard gets into it. */
    onCardFocus: (fn: (() => boolean) | undefined) => (focusCard = fn),
  }
}
