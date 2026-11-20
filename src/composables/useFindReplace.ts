// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch } from 'vue'
import { bookScenes, sceneLabels } from '@/domain/outline'
import { planReplace, skippedWords } from '@/index/find-replace'
import { groupPlaces } from '@/index/rename'
import { wordsFor } from '@/storage/errors'
import { applyRename, type RenameRun } from '@/storage/rename-everywhere'
import { useBackupStore } from '@/stores/backup'
import { useEditsStore } from '@/stores/edits'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { noteSnapshot } from './useHistory'
import { undoRun } from './useRenameEverywhere'

const OPTIONS_OFF = { matchCase: false, wholeWords: false }
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`

/**
 * Find and replace in the scene text of the open book. Every match is listed by scene and ticked;
 * the ticked ones are changed in one step through the rename writer (a version, a "Before replace"
 * snapshot, a copy of each file, a compare before each write), and one Undo puts them back.
 */
export function useFindReplace() {
  const ws = useWorkspaceStore()
  const layout = useLayoutStore()
  const edits = useEditsStore()
  const backup = useBackupStore()

  const find = ref('')
  const replace = ref('')
  const matchCase = ref(false)
  const wholeWords = ref(false)
  const busy = ref(false)
  const error = ref('')
  /** The places the author unticked; every other place is ticked. */
  const unticked = shallowRef(new Set<string>())

  /** Only in a workspace that can be written to, with a book open. */
  const available = computed(() => !!ws.session && !!ws.book && !ws.view?.readOnly)
  const open = computed({
    get: () => layout.findReplaceOpen && available.value,
    set: (v: boolean) => (layout.findReplaceOpen = v),
  })
  // Asked for where it cannot open (the welcome screen, the sample): forgotten, not opened later.
  watch(
    () => layout.findReplaceOpen && !available.value,
    (stale) => stale && (layout.findReplaceOpen = false),
  )
  // Words selected in the text are what the author most likely wants to find.
  watch(open, (now) => {
    error.value = ''
    const picked = edits.selectedText?.trim()
    if (now && picked && !picked.includes('\n') && picked.length <= 80) find.value = picked
  })
  watch([find, matchCase, wholeWords], () => (unticked.value = new Set()))

  const found = computed(() => {
    const data = ws.data
    const book = ws.bookId
    if (!open.value || !data || !book) return planReplace([], '', '', OPTIONS_OFF)
    const labels = sceneLabels(data, book)
    const docs = bookScenes(data, book).map((s) => ({
      id: s.meta.id,
      where: `${labels.get(s.meta.id) ?? ''} · ${s.meta.title}`,
      body: s.body,
    }))
    return planReplace(
      docs,
      find.value,
      replace.value,
      { matchCase: matchCase.value, wholeWords: wholeWords.value },
      book,
    )
  })
  const places = computed(() => found.value.plan.places)
  const ticked = computed(
    () => new Set(places.value.filter((p) => !unticked.value.has(p.key)).map((p) => p.key)),
  )
  const sceneCount = computed(
    () => new Set(places.value.filter((p) => ticked.value.has(p.key)).map((p) => p.docId)).size,
  )

  function toggle(key: string) {
    const next = new Set(unticked.value)
    if (!next.delete(key)) next.add(key)
    unticked.value = next
  }
  const tickAll = (on: boolean) =>
    (unticked.value = on ? new Set() : new Set(places.value.map((p) => p.key)))

  function say(run: RenameRun) {
    const done = `${many(run.places, 'place', 'places')} in ${many(run.done, 'scene', 'scenes')}`
    const undo = undoRun(run)
    edits.toast = run.stopped
      ? {
          text: `Stopped: “${run.stopped.title}” ${run.stopped.why === 'changed' ? 'changed while this ran' : 'could not be saved'}. ${done} were replaced before it. The snapshot “Before replace” is in History.`,
          error: true,
          undo,
        }
      : { text: `Replaced ${done}.`, undo }
  }

  async function apply() {
    const session = ws.session
    const book = ws.bookId
    const plan = found.value.plan
    if (!session || !book || busy.value || !ticked.value.size) return
    busy.value = true
    error.value = ''
    try {
      // The open scene's words not yet saved go first: what is replaced, and the snapshot, hold them.
      await ws.flush()
      const run = await applyRename(session, plan, ticked.value, {
        snapshotBook: book,
        saveVersion: () => backup.beforeRisky('before-replace'),
      })
      noteSnapshot()
      say(run)
      open.value = false
    } catch (e) {
      error.value = wordsFor(e, 'That did not work. Nothing was changed.')
    } finally {
      busy.value = false
    }
  }

  return {
    open,
    available,
    find,
    replace,
    matchCase,
    wholeWords,
    busy,
    error,
    groups: computed(() => groupPlaces(places.value)),
    total: computed(() => places.value.length),
    skipped: computed(() => skippedWords(found.value.skipped)),
    ticked,
    count: computed(() => ticked.value.size),
    sceneCount,
    toggle,
    tickAll,
    apply,
    cancel: () => (open.value = false),
  }
}
