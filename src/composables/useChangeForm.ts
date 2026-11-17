// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope, reactive, ref } from 'vue'
import {
  STATUSES,
  STATUS_WORDS,
  kindOfPick,
  pickOfKind,
  relationNow,
  type Change,
  type ChangePick,
} from '@/domain/change-kinds'
import { personState } from '@/domain/continuity-state'
import { wordsFor } from '@/storage/errors'
import { colourOf } from '@/domain/scene-details'
import { addChange, removeChange, restoreChange, updateChange } from '@/storage/continuity-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useContinuityModel } from './useContinuityModel'
import { useOutlineEdits } from './useOutlineEdits'

const blank = () => ({
  pick: 'relation' as ChangePick,
  who: '',
  with: '',
  item: '',
  gains: true,
  value: '',
  status: 'dead',
  place: '',
  of: '',
  quote: '',
})

/**
 * The "What changes in this scene?" board: who, what happens to them, the details — in plain
 * words, never the stored kind names. Adds a change to the scene, or corrects or removes one (a
 * change is found by its place in the scene's list, and by what it said when the author opened it).
 */
export function useChangeForm(sceneId: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const edits = useEditsStore()
  const { model } = useContinuityModel()
  const open = ref(false)
  const error = ref('')
  const f = reactive(blank())
  /** The change being corrected, by place and as it was when the board opened. */
  const editing = ref<{ at: number; was: Change } | null>(null)

  const scene = computed(() => ws.data?.scenes.find((s) => s.meta.id === sceneId()))
  const changes = computed<Change[]>(() => scene.value?.meta.changes ?? [])
  const canEdit = edit.canEdit

  // ---- Who and what the options are ---------------------------------------------------------------
  const nameOf = (id?: string) => (id ? (model.value?.nameOf(id) ?? '') : '')
  const present = computed(() => {
    const p = model.value?.presence.get(sceneId() ?? '')
    return [...(p?.present ?? [])].sort(
      (a, b) => Number(b === p?.pov) - Number(a === p?.pov) || nameOf(a).localeCompare(nameOf(b)),
    )
  })
  const records = (type: string) =>
    (ws.data?.records ?? [])
      .filter(
        (r) =>
          r.meta.type === type &&
          (r.meta.scope === 'universe'
            ? r.universe === ws.universe?.id
            : r.meta.scope === `book:${ws.bookId}`),
      )
      .map((r) => ({ value: r.meta.id, label: r.meta.title }))
      .sort((a, b) => a.label.localeCompare(b.label))
  const characters = computed(() => records('character'))
  const options = computed(() => ({
    people: characters.value,
    arcs: records('arc'),
    places: records('place'),
    items: records('item'),
    status: STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] })),
    others: characters.value.filter((c) => c.value !== f.who),
  }))
  /** Set-ups anywhere in the universe's books that this scene could pay off; the ones still open come first. */
  const setups = computed(() => {
    const data = ws.data
    if (!data) return []
    const paid = new Set(
      data.scenes.flatMap((s) =>
        (s.meta.changes ?? []).flatMap((c) => (c.kind === 'payoff' && c.of ? [c.of] : [])),
      ),
    )
    return data.scenes
      .flatMap((s) =>
        (s.meta.changes ?? []).flatMap((c) =>
          c.kind === 'setup' && c.id
            ? [
                {
                  value: c.id,
                  label: `“${c.value ?? ''}” (${model.value?.byId.get(s.meta.id)?.ref ?? s.meta.title})`,
                  open: !paid.has(c.id),
                },
              ]
            : [],
        ),
      )
      .sort((a, b) => Number(b.open) - Number(a.open))
  })
  const forArc = computed(() => f.pick === 'beat')
  const aboutNobody = computed(() => f.pick === 'setup' || f.pick === 'payoff')

  /** What they are to each other as of the start of this scene: the "Was" of a relationship. */
  const was = computed(() => {
    if (editing.value && editing.value.was.kind === 'relation' && f.pick === 'relation') {
      const first = (editing.value.was.value ?? '').split('→')
      if (first.length > 1) return first.slice(0, -1).join('→').trim()
    }
    const before = model.value?.flow.before.get(sceneId() ?? '')
    if (!before || !f.who || !f.with) return ''
    return personState(before, f.who).relations.find((r) => r.with === f.with)?.lines[0]?.text ?? ''
  })

  /** The change as the form says it, or undefined when the pick has nothing to say yet. */
  const built = computed<Change>(() => {
    const quote = f.quote.trim() ? { quote: f.quote.trim() } : {}
    const value = f.value.trim()
    const kind = kindOfPick(f.pick, f.gains)
    switch (f.pick) {
      case 'relation':
        return {
          kind,
          who: f.who,
          with: f.with,
          value: was.value ? `${was.value} → ${value}` : value,
          ...quote,
        }
      case 'item':
        return { kind, who: f.who, item: f.item, ...quote }
      case 'status':
        return { kind, who: f.who, value: f.status, ...quote }
      case 'location':
        return { kind, who: f.who, with: f.place, ...quote }
      case 'setup':
        return {
          kind,
          value,
          ...(editing.value?.was.id ? { id: editing.value.was.id } : {}),
          ...quote,
        }
      case 'payoff':
        return { kind, of: f.of, ...quote }
      default:
        return { kind, who: f.who, value, ...quote }
    }
  })

  /** "From 7.2 on, Tomas sees Elena as a creditor (was: stranger)." */
  const preview = computed(() => {
    const ref = model.value?.byId.get(sceneId() ?? '')?.ref ?? 'here'
    const [who, other] = [nameOf(f.who) || 'They', nameOf(f.with)]
    const v = f.value.trim()
    switch (f.pick) {
      case 'relation':
        return v && other
          ? `From ${ref} on, ${who} sees ${other} as ${v}${was.value ? ` (was: ${was.value})` : ''}.`
          : ''
      case 'knows':
        return v ? `From ${ref} on, ${who} knows: ${v}.` : ''
      case 'status':
        return `From ${ref} on, ${who}: ${STATUS_WORDS[f.status as keyof typeof STATUS_WORDS]?.toLowerCase() ?? ''}.`
      default:
        return ''
    }
  })

  // ---- Opening, saving ------------------------------------------------------------------------------
  function reset(over: Partial<ReturnType<typeof blank>> = {}) {
    Object.assign(f, blank(), over)
    error.value = ''
  }
  /** Start a new change; `who` is the first person on the page (the point of view) unless one is given. */
  function startAdd(who?: string, quote = '') {
    editing.value = null
    reset({ who: who ?? present.value[0] ?? '', quote: quote.trim() })
    open.value = true
  }
  function startEdit(at: number) {
    const c = changes.value[at]
    const pick = c && pickOfKind(c.kind)
    if (!c || !pick) return
    editing.value = { at, was: c }
    reset({
      pick,
      who: c.who ?? '',
      with: pick === 'relation' ? (c.with ?? '') : '',
      place: pick === 'location' ? (c.with ?? '') : '',
      item: c.item ?? '',
      gains: c.kind !== 'loses',
      value: pick === 'relation' ? relationNow(c.value) : pick === 'status' ? '' : (c.value ?? ''),
      status: pick === 'status' ? (c.value ?? 'dead') : 'dead',
      of: c.of ?? '',
      quote: c.quote ?? '',
    })
    open.value = true
  }
  /** Picking another kind of change keeps who, and drops what only fitted the last one. */
  function choose(pick: ChangePick) {
    const keep = f.pick === 'beat' || pick === 'beat' ? '' : f.who
    f.pick = pick
    f.who = keep || (pick === 'beat' ? '' : (present.value[0] ?? ''))
    error.value = ''
  }

  async function run(work: () => Promise<void>) {
    error.value = ''
    try {
      await work()
      return true
    } catch (e) {
      error.value = wordsFor(e)
      return false
    }
  }
  /** Saving is one turn at a time: a second press while the first is being written does nothing. */
  const saving = ref(false)
  const save = async () => {
    if (saving.value) return false
    saving.value = true
    try {
      return await run(async () => {
        const id = sceneId()
        if (!ws.session || !id) return
        const e = editing.value
        if (e) await updateChange(ws.session, id, e.at, e.was, built.value)
        else await addChange(ws.session, id, built.value)
        open.value = false
        await edits.announce(e ? 'Change saved.' : 'Change added.')
      })
    } finally {
      saving.value = false
    }
  }
  /** Take a change away, with the way back: an Undo in the toast puts it where it was. */
  const remove = (at: number) =>
    run(async () => {
      const id = sceneId()
      const c = changes.value[at]
      const session = ws.session
      if (!session || !id || !c) return
      await removeChange(session, id, at, c)
      edits.toast = {
        text: 'Removed a change.',
        undo: () => restoreChange(session, id, at, c),
      }
      await edits.announce('Change removed.')
    })
  /** The colour of a character, as CSS, for their chip. */
  const colour = (id: string) => {
    const c = colourOf(ws.data?.records.find((r) => r.meta.id === id))
    return c ? `var(--${c})` : undefined
  }

  return {
    open,
    error,
    f,
    editing,
    changes,
    canEdit,
    present,
    options,
    setups,
    forArc,
    aboutNobody,
    was,
    preview,
    nameOf,
    startAdd,
    startEdit,
    choose,
    save,
    remove,
    saving,
    colour,
  }
}

const shared = new WeakMap<object, ReturnType<typeof useChangeForm>>()

/**
 * The one board of the open scene. The inspector's list, the palette, the shortcut and "Mark as
 * change" all open it, so it is made once, with the scene the screen is on.
 */
export function useSharedChangeForm() {
  const ws = useWorkspaceStore()
  let form = shared.get(ws)
  if (!form) {
    form = effectScope(true).run(() => useChangeForm(() => ws.sceneId ?? undefined))!
    shared.set(ws, form)
  }
  return form
}
