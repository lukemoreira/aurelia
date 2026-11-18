// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope, ref, shallowRef, watch } from 'vue'
import type { Proposal } from '@/domain/proposals'
import { wordsFor } from '@/storage/errors'
import {
  NOT_CLEARED,
  acceptProposal,
  listProposals,
  rejectProposal,
  stillApplies,
} from '@/storage/proposal-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { noteSnapshot } from './useHistory'
import { useAssistant } from './useAssistant'

function createProposals() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const assistant = useAssistant()
  const all = shallowRef<Proposal[]>([])
  /** The proposal being worked on (Accept, Reject or Ask for changes), so its buttons wait. */
  const working = ref<string | null>(null)

  async function refresh() {
    const s = ws.session
    all.value = s ? await listProposals(s.adapter).catch(() => []) : []
  }
  // A sync round brings proposals in as files; any change to the workspace looks again.
  let unsubscribe: (() => void) | undefined
  watch(
    () => ws.session,
    (s) => {
      unsubscribe?.()
      // A keystroke is a change too: look once things are quiet, not on every one.
      let timer: ReturnType<typeof setTimeout> | undefined
      unsubscribe = s?.subscribe(() => {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 800)
      })
      void refresh()
    },
    { immediate: true },
  )
  watch(
    () => assistant.answered.value,
    () => void refresh(),
  )

  /** Which proposals no longer apply as they stand (their paragraph changed since). */
  const outOfDate = computed(() => {
    void ws.data // the text now
    const s = ws.session
    return new Set(s ? all.value.filter((p) => !stillApplies(s, p)).map((p) => p.id) : [])
  })

  /** The proposals shown in one scene: its edits, and new scenes that would come after it in its chapter. */
  function forScene(sceneId: string): Proposal[] {
    const scene = ws.data?.scenes.find((s) => s.meta.id === sceneId)
    const last = ws.data?.scenes
      .filter((s) => s.meta.chapter === scene?.meta.chapter)
      .sort((a, b) => (a.meta.order < b.meta.order ? -1 : 1))
      .at(-1)
    return all.value.filter((p) =>
      p.kind === 'edit'
        ? p.sceneId === sceneId
        : p.chapterId === scene?.meta.chapter && last?.meta.id === sceneId,
    )
  }

  async function act(p: Proposal, work: () => Promise<void>) {
    if (working.value) return
    working.value = p.id
    try {
      await work()
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That did not work. Nothing was changed.'), error: true }
    } finally {
      working.value = null
      await refresh()
    }
  }

  const accept = (p: Proposal) =>
    act(p, async () => {
      const done = await acceptProposal(ws.session!, p)
      if (done.snapshot) noteSnapshot()
      edits.toast = !done.cleared
        ? { text: NOT_CLEARED, error: true }
        : {
            text:
              p.kind === 'scene'
                ? `“${p.title}” is in the book.`
                : `Accepted for “${p.sceneTitle}”. A snapshot was saved first, in History.`,
          }
    })

  const reject = (p: Proposal) => act(p, () => rejectProposal(ws.session!, p.id))

  /**
   * Send the author's note and the proposal to the assistant. Its revision names this one as replaced;
   * this one goes only once the revision is here, so the two show as one.
   */
  const askChanges = (p: Proposal, note: string) =>
    act(p, async () => {
      // Only the author's own words go in the message: the proposal is read back with a tool, as data.
      const ok = await assistant.send(
        `Please revise your proposal ${p.id} (read it with get_proposal) and make a new proposal with replaces "${p.id}". My note: ${note.trim() || 'the text changed since; make it fit the scene as it is now.'}`,
      )
      if (!ok)
        throw new Error(assistant.turns.value.at(-1)?.error ?? 'The assistant did not answer.')
    })

  return { all, working, outOfDate, refresh, forScene, accept, reject, askChanges }
}

const shared = new WeakMap<object, ReturnType<typeof createProposals>>()

/** The Review inbox: the assistant's proposals, Accept, Reject and Ask for changes. */
export function useProposals() {
  const ws = useWorkspaceStore()
  let it = shared.get(ws)
  if (!it) {
    it = effectScope(true).run(createProposals)!
    shared.set(ws, it)
  }
  return it
}
