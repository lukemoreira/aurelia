// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { sceneLabels, bookScenes } from '@/domain/outline'
import { wordsFor } from '@/storage/errors'
import { addChoice, removeChoice, setEnding, setStart, updateChoice } from '@/storage/story-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useEditsStore } from '@/stores/edits'
import { useOutlineEdits } from './useOutlineEdits'

/** The "add a choice" form's value for "a scene that does not exist yet". */
export const NEW_SCENE = '__new'
/** What a choice shows for a target that is no longer a scene of this book. */
export const GONE = '__gone'

/**
 * A scene's choices (label → target scene), its ending flag and whether it starts the story: what
 * the author edits in the inspector and the story map's side panel. A label saves when the author
 * leaves the field, a target when it is picked; adding a choice can make its scene in one step.
 */
export function useChoices(idOf: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const edits = useEditsStore()
  const error = ref('')
  const labels = reactive<Record<string, string>>({})
  const add = reactive({ label: '', target: NEW_SCENE })

  const scene = computed(() => ws.data?.scenes.find((s) => s.meta.id === idOf()))
  const choices = computed(() => scene.value?.meta.choices ?? [])
  const readOnly = computed(() => !edit.canEdit.value)
  const book = computed(() =>
    ws.data?.books.find((b) => b.id === (scene.value?.book ?? ws.bookId ?? '')),
  )

  /** Every scene of the book in reading order, as a target to pick. */
  const targets = computed(() => {
    const data = ws.data
    const id = book.value?.id
    if (!data || !id) return []
    const refs = sceneLabels(data, id)
    return bookScenes(data, id).map((s) => ({
      value: s.meta.id,
      label: `${refs.get(s.meta.id) ?? ''} · ${s.meta.title}`,
    }))
  })
  /** A choice's options: the scenes, and a line for a scene that is gone. */
  const optionsFor = (target: string) =>
    targets.value.some((o) => o.value === target)
      ? targets.value
      : [{ value: GONE, label: 'A scene that is no longer here' }, ...targets.value]
  const targetOf = (target: string) =>
    targets.value.some((o) => o.value === target) ? target : GONE
  const addOptions = computed(() => [{ value: NEW_SCENE, label: 'A new scene' }, ...targets.value])

  /** What each label last matched in the files. */
  const seen: Record<string, string> = {}
  const forget = (k: string) => {
    delete labels[k]
    delete seen[k]
  }
  const resetLabels = () => {
    for (const k of Object.keys(labels)) forget(k)
    for (const c of choices.value) labels[c.id] = seen[c.id] = c.label
    error.value = ''
  }
  watch(idOf, resetLabels, { immediate: true })
  // The files change under what is typed: a label follows only when ITS stored words changed and
  // the author has not changed it; one a save of another choice touched keeps what is typed.
  watch(
    () => choices.value.map((c) => `${c.id}\u0000${c.label}`).join('\u0001'),
    () => {
      const live = new Set(choices.value.map((c) => c.id))
      for (const k of Object.keys(labels)) if (!live.has(k)) forget(k)
      for (const c of choices.value) {
        if (!(c.id in seen)) labels[c.id] = seen[c.id] = c.label
        else if (c.label !== seen[c.id]) {
          if (labels[c.id] === seen[c.id]) labels[c.id] = c.label
          seen[c.id] = c.label
        }
      }
    },
  )

  async function run(work: () => Promise<void>) {
    error.value = ''
    try {
      await work()
    } catch (e) {
      error.value = wordsFor(e) // what was typed stays, to be tried again
    }
  }

  /**
   * The form is emptied as it is sent, not when the file is written: the new scene shows on the map
   * before the save is over, and the next choice may already be being typed. A choice that fails to
   * save puts its words back (unless something else has been typed since).
   */
  let adding = false
  /** A new scene made for a choice whose save then failed: the next try leads to it, not to another. */
  let made: { label: string; target: string } | undefined
  const addNow = () =>
    run(async () => {
      const id = idOf()
      if (!ws.session || !id || adding) return
      const sent = { label: add.label, target: add.target }
      adding = true
      add.label = ''
      add.target = NEW_SCENE
      const label = sent.label.trim()
      const reuse = sent.target === NEW_SCENE && made?.label === label ? made.target : undefined
      try {
        await addChoice(ws.session, id, {
          label: sent.label,
          ...(sent.target !== NEW_SCENE || reuse
            ? { target: reuse ?? sent.target }
            : { onScene: (target: string) => (made = { label, target }) }),
        })
        made = undefined
        await edits.announce('Choice added.')
      } catch (e) {
        if (!add.label) Object.assign(add, sent)
        throw e
      } finally {
        adding = false
      }
    })
  const relabel = (choice: string) =>
    run(async () => {
      const id = idOf()
      const label = labels[choice] ?? ''
      if (ws.session && id && label.trim() !== choices.value.find((c) => c.id === choice)?.label)
        await updateChoice(ws.session, id, choice, { label })
    })
  const retarget = (choice: string, target: string) =>
    run(async () => {
      const id = idOf()
      if (ws.session && id && target !== GONE)
        await updateChoice(ws.session, id, choice, { target })
    })
  const remove = (choice: string) =>
    run(async () => {
      const id = idOf()
      if (ws.session && id) await removeChoice(ws.session, id, choice)
    })

  const ending = computed({
    get: () => scene.value?.meta.ending === true,
    set: (v: boolean) =>
      void run(async () => {
        const id = idOf()
        if (ws.session && id) await setEnding(ws.session, id, v)
      }),
  })
  /** The scene the reader starts in: `book.start`, else the first scene. */
  const isStart = computed(() => {
    const b = book.value
    const ids = ws.data && b ? bookScenes(ws.data, b.id).map((s) => s.meta.id) : []
    return (b?.start && ids.includes(b.start) ? b.start : ids[0]) === idOf()
  })
  const makeStart = () =>
    run(async () => {
      const id = idOf()
      if (ws.session && id && book.value) await setStart(ws.session, book.value.id, id)
    })

  return {
    scene,
    choices,
    labels,
    add,
    addOptions,
    optionsFor,
    targetOf,
    error,
    readOnly,
    addNow,
    relabel,
    retarget,
    remove,
    ending,
    isStart,
    makeStart,
  }
}
