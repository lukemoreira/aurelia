// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {
  certainPlaces,
  groupPlaces,
  planRename,
  proposeForms,
  renamedAliases,
  type RenameForm,
  type RenamePlace,
  type RenamePlan,
} from '@/index/rename'
import { wordsFor } from '@/storage/errors'
import { applyRename, undoRename, type RenameRun } from '@/storage/rename-everywhere'
import { useBackupStore } from '@/stores/backup'
import { useEditsStore, type RenameOffer } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`

/** The Undo of a toast after a run of changes (rename everywhere, find and replace): puts the files back and says how it went. */
export function undoRun(run: RenameRun) {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  return async () => {
    try {
      const r = await undoRename(ws.session!, run)
      edits.toast = {
        text: r.kept.length
          ? `Put ${many(r.restored, 'file', 'files')} back. ${r.kept.join(', ')} had new words, so it was left as it is.`
          : `Put ${many(r.restored, 'file', 'files')} back.`,
      }
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That could not be undone.'), error: true }
    }
  }
}

/**
 * "Change the name in your text too?" (ADR-0010 §6). Opens after a record is renamed, when its old
 * name is written somewhere: the author sees each form and every place, uncertain ones unticked,
 * and changes the ticked ones in one step that can be undone. Looking changes nothing.
 */
export function useRenameEverywhere() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const backup = useBackupStore()

  const open = ref(false)
  const offer = shallowRef<RenameOffer | null>(null)
  const forms = ref<RenameForm[]>([])
  const plan = shallowRef<RenamePlan | null>(null)
  const ticked = shallowRef(new Set<string>())
  const filter = ref<'all' | 'uncertain'>('all')
  const busy = ref(false)
  const error = ref('')
  /** After the change: the places that were left as they are, listed again. */
  const result = shallowRef<{ changed: number; left: RenamePlace[] } | null>(null)

  const record = computed(() => ws.data?.records.find((r) => r.meta.id === offer.value?.recordId))
  const oldTitle = computed(() => offer.value?.before.title ?? '')
  const newTitle = computed(() => record.value?.meta.title ?? '')

  /** The forms as they will be used: a form left blank is a form kept, and spaces around one are not part of it. */
  const cleanForms = () => forms.value.map((f) => ({ from: f.from, to: f.to.trim() || f.from }))

  function replan(initial = false) {
    const o = offer.value
    if (!o) return
    const known = new Set(plan.value?.places.map((p) => p.key))
    const before = ticked.value
    const next = planRename(ws.index, o.recordId, o.before, cleanForms())
    plan.value = next
    ticked.value = initial
      ? certainPlaces(next)
      : new Set(
          next.places
            .filter((p) => (known.has(p.key) ? before.has(p.key) : !p.uncertain))
            .map((p) => p.key),
        )
  }

  /** The name dialog is gone: look for the old name in the text, and ask only if it is there. */
  function begin(o: RenameOffer) {
    edits.renameOffer = null
    const title = ws.data?.records.find((r) => r.meta.id === o.recordId)?.meta.title
    if (!title || title === o.before.title) return
    offer.value = o
    forms.value = proposeForms(o.before.title, title, o.before.aliases)
    filter.value = 'all'
    error.value = ''
    result.value = null
    replan(true)
    open.value = (plan.value?.places.length ?? 0) > 0
  }

  // The name dialog closes first and gives focus back; this one opens after, so the two never fight over it.
  watch(
    () => [edits.renameOffer, edits.ask] as const,
    async ([o, ask]) => {
      if (!o || ask || open.value) return
      await nextTick()
      setTimeout(() => begin(o), 0)
    },
  )

  /** The author changed what a form becomes: find the places again, keeping the ticks already given. */
  function setForm(i: number, to: string) {
    forms.value[i]!.to = to
    replan()
  }

  const places = computed(() => plan.value?.places ?? [])
  const uncertain = computed(() => places.value.filter((p) => p.uncertain))
  const shown = computed(() => (filter.value === 'uncertain' ? uncertain.value : places.value))
  /** Places by where they are, in reading order. */
  const groups = computed(() => groupPlaces(shown.value))
  /** "2 books · 31 scenes · 3 notes": how widely the old name is written. */
  const reach = computed(() => {
    const scenes = new Set<string>()
    const notes = new Set<string>()
    const books = new Set<string>()
    for (const p of places.value) {
      ;(p.kind === 'scene' ? scenes : notes).add(p.docId)
      if (p.bookId) books.add(p.bookId)
    }
    return [
      books.size && many(books.size, 'book', 'books'),
      scenes.size && many(scenes.size, 'scene', 'scenes'),
      notes.size && many(notes.size, 'note', 'notes'),
    ]
      .filter(Boolean)
      .join(' · ')
  })
  const count = computed(() => ticked.value.size)

  function toggle(key: string) {
    const next = new Set(ticked.value)
    if (!next.delete(key)) next.add(key)
    ticked.value = next
  }
  /** "Tick all" ticks the certain places only: an uncertain one is always the author's own choice. */
  const tickAll = (on: boolean) =>
    (ticked.value = on && plan.value ? certainPlaces(plan.value) : new Set())

  function say(run: RenameRun) {
    const done = many(run.done, 'scene or note', 'scenes and notes')
    // A copy of each file is always kept; a version only when it really reached the server.
    const safe = `A copy of each file was kept first, in the .aurelia folder.${run.versioned ? ' A version was saved too.' : ''}`
    const undo = undoRun(run)
    edits.toast = run.stopped
      ? {
          text: `Stopped: “${run.stopped.title}” ${run.stopped.why === 'changed' ? 'changed while this ran' : 'could not be saved'}. ${many(run.places, 'place', 'places')} in ${done} were changed before it. ${safe}`,
          error: true,
          undo,
        }
      : { text: `Changed ${many(run.places, 'place', 'places')} in ${done}. ${safe}`, undo }
  }

  async function apply() {
    const session = ws.session
    const o = offer.value
    const p = plan.value
    if (!session || !o || !p || busy.value) return
    busy.value = true
    error.value = ''
    try {
      const after = renamedAliases(o.before.aliases, cleanForms())
      const changed = JSON.stringify(after) !== JSON.stringify(o.before.aliases)
      const run = await applyRename(session, p, ticked.value, {
        recordId: o.recordId,
        ...(changed ? { aliases: { before: o.before.aliases, after } } : {}),
        saveVersion: () => backup.beforeRisky('before-rename-everywhere'),
      })
      say(run)
      const left = p.places.filter((pl) => !ticked.value.has(pl.key))
      // Places left as they are are listed again, so nothing is forgotten.
      if (left.length && !run.stopped) result.value = { changed: run.places, left }
      else open.value = false
    } catch (e) {
      error.value = wordsFor(e, 'That did not work. Nothing was changed.')
    } finally {
      busy.value = false
    }
  }

  return {
    open,
    forms,
    plan,
    filter,
    result,
    reach,
    busy,
    error,
    oldTitle,
    newTitle,
    uncertain,
    groups,
    count,
    total: computed(() => places.value.length),
    ticked,
    setForm,
    toggle,
    tickAll,
    apply,
    cancel: () => (open.value = false),
  }
}
