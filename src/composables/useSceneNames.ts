// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed } from 'vue'
import type { FoundName, OpenQuestion } from '@/index/workspace-index'
import { wordsFor } from '@/storage/errors'
import { addIgnoredNames } from '@/storage/names-actions'
import { setDetails } from '@/storage/outline-actions'
import { useEditsStore } from '@/stores/edits'
import { useReviewStore } from '@/stores/review'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * "Not a name": the one place the answer is written and told. Every way of giving it (a card in the
 * text, the Names tab) comes here, so each says what it did and offers Undo, which puts the scene's
 * answers back as they were.
 */
export function useNotAName() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  return async function notAName(sceneId: string, keys: string[]) {
    const session = ws.session
    if (!session || !keys.length) return
    const before = ws.data?.scenes.find((s) => s.meta.id === sceneId)?.meta.ignoreNames ?? []
    try {
      await addIgnoredNames(session, sceneId, keys)
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That could not be saved. Nothing was lost.'), error: true }
      return
    }
    edits.toast = {
      text:
        keys.length === 1 ? 'Marked as not a name.' : `Marked ${keys.length} places as not a name.`,
      undo: async () => {
        try {
          await setDetails(session, sceneId, { ignoreNames: before.length ? before : undefined })
        } catch (e) {
          edits.toast = { text: wordsFor(e, 'That could not be undone.'), error: true }
        }
      },
    }
  }
}

/** What the Names tab shows of the open scene: the names found, the questions, and what answers do. */
export function useSceneNames() {
  const ws = useWorkspaceStore()
  const review = useReviewStore()
  const notAName = useNotAName()

  const found = computed<FoundName[]>(() => {
    void ws.indexVersion // look again whenever the workspace changed
    return ws.sceneId ? ws.index.foundNames(ws.sceneId) : []
  })
  const questions = computed<OpenQuestion[]>(() => {
    void ws.indexVersion
    return ws.sceneId ? ws.index.openQuestions(ws.sceneId) : []
  })

  /** "as “Elena”, “Elena’s”": the ways it is written here, when that is more than its name. */
  const writtenAs = (f: FoundName) => {
    const forms = f.forms.map((x) => x.text).filter((t) => t !== f.target.title)
    return forms.length ? `as ${forms.map((t) => `“${t}”`).join(', ')}` : ''
  }
  const who = (q: OpenQuestion) =>
    q.candidates.length === 1
      ? `${q.candidates[0]!.title}, or the word “${q.text.toLowerCase()}”?`
      : `${q.candidates.map((c) => `${c.title} (${c.label.toLowerCase()})`).join(' or ')}?`

  return {
    found,
    questions,
    writtenAs,
    who,
    /** Take the caret to the first place this is asked about, where its card opens. */
    review: (q: OpenQuestion) => (review.name = q.text),
    notAName: (q: OpenQuestion) =>
      ws.sceneId ? notAName(ws.sceneId, ws.index.ignoreKeys(ws.sceneId, q.text)) : undefined,
  }
}
