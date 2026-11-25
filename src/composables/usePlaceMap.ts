// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { clamp01, scenesSetHere, shownPins } from '@/domain/place-maps'
import { placeAncestors, placeChildren, placeWithin } from '@/domain/places'
import { wordsFor } from '@/storage/errors'
import { movePinOf, pinPlace, setMapPicture, unpinPlace } from '@/storage/place-map-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useMedia } from './useMedia'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'
import { useVisibleRecords } from './useWorld'

/** How long arrow keys wait for the next press before the move is saved. */
const KEY_SAVE_MS = 500
/** How far an arrow key moves a pin, as a fraction of the picture (Shift: further). */
export const NUDGE = 0.01
export const NUDGE_FAR = 0.05

/**
 * The Map tab of a place or world (ADR-0017): its picture, its pins and what a pin opens. Every finished
 * action (a drop, the end of a drag, a run of arrow keys) is one write to the record's own file, through
 * the same path as any other detail, so the journal, backups and sync carry it.
 */
export function usePlaceMap(idOf: () => string) {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const edit = useOutlineEdits()
  const nav = useNavigation()
  const media = useMedia()
  const records = useVisibleRecords()
  const error = ref('')

  const record = computed(() => ws.data?.records.find((r) => r.meta.id === idOf()))
  const hasPicture = (mapId: string | undefined) =>
    !!mapId && !!ws.data?.media?.some((m) => m.meta.id === mapId)
  const mapId = computed(() => record.value?.meta.map)
  /** A map was chosen and its picture was deleted since (it waits in Recently deleted). */
  const pictureGone = computed(() => !!mapId.value && !hasPicture(mapId.value))
  const hasMap = computed(() => hasPicture(mapId.value))
  const canEdit = computed(() => edit.canEdit.value)

  // What the author is doing: looking, or editing pins; which pin is open; which place is waiting for a click.
  const editing = ref(false)
  const selected = ref<string>()
  const placing = ref<string>()
  // Where a pin is drawn while it is being dragged or nudged, before its write lands, and the key presses still
  // waiting to be saved. Both are kept per record: the tab is reused when another record opens.
  const live = reactive(new Map<string, { x: number; y: number }>())
  const timers = new Map<
    string,
    { id: string; place: string; timer: ReturnType<typeof setTimeout> }
  >()
  const keyOf = (id: string, place: string) => `${id}\u0000${place}`

  // Before the record changes, whatever waits to be saved is saved — to the record it was done on.
  watch(
    idOf,
    () => {
      flush()
      editing.value = false
      selected.value = placing.value = undefined
      error.value = '' // another record's refusal is not this one's
    },
    { flush: 'sync' },
  )
  watch(canEdit, (can) => {
    if (can) return
    editing.value = false
    placing.value = undefined
  })

  /**
   * One write to the record `id` (the one the action started on, never whichever is open when it runs). It says
   * whether it was made: a refusal is shown, and nothing is announced or focused as if it had been.
   */
  async function save(task: (s: NonNullable<typeof ws.session>) => Promise<void>, id = idOf()) {
    const session = ws.session
    if (!session || !id) return false
    error.value = ''
    try {
      await task(session)
      return true
    } catch (e) {
      error.value = wordsFor(e)
      return false
    }
  }

  const pins = computed(() =>
    shownPins(record.value?.meta.pins, records.value, idOf()).map((p) => ({
      ...p,
      ...live.get(keyOf(idOf(), p.place)),
    })),
  )
  const pinned = computed(() => new Set(pins.value.map((p) => p.place)))

  const choosePicture = (picture: string, id = idOf()) =>
    save((s) => setMapPicture(s, id, picture), id)
  /** Taking the map away takes its pins with it. */
  const removeMap = () => {
    const id = idOf()
    selected.value = placing.value = undefined
    editing.value = false
    return save((s) => setMapPicture(s, id, undefined), id)
  }
  /** Import files as the map's picture: the first one is used, for the record the import was started on. */
  async function addPicture(files: File[]) {
    const id = idOf() // before the import: a slow one must not land on whichever record is open by then
    const [made] = await media.importFiles(files.slice(0, 1))
    if (made) await choosePicture(made, id)
  }

  /** Put a place on the map (a place already there is moved). Says whether it was done. */
  async function drop(place: string, x: number, y: number) {
    const id = idOf()
    placing.value = undefined
    const done = await save((s) => pinPlace(s, id, place, x, y), id)
    if (done) await edits.announce(`“${titleOf(place)}” is on the map.`)
    return done
  }
  /** While dragging: only on screen. */
  const drag = (place: string, x: number, y: number) =>
    live.set(keyOf(idOf(), place), { x: clamp01(x), y: clamp01(y) })
  /** The end of a drag, or a run of arrow keys: one write, with where the pin ended up. */
  async function settle(place: string, id = idOf()) {
    const key = keyOf(id, place)
    const at = live.get(key)
    if (!at) return
    const done = await save((s) => movePinOf(s, id, place, at.x, at.y), id)
    const now = live.get(key)
    // Saved, or refused (the pin goes back to where the file has it, and no flush tries it again).
    if (now && (!done || (now.x === at.x && now.y === at.y))) live.delete(key)
  }
  /** An arrow key: the pin moves on screen at once, the write waits for the keys to stop. */
  function nudge(place: string, dx: number, dy: number) {
    const id = idOf()
    const key = keyOf(id, place)
    const from = live.get(key) ?? pins.value.find((p) => p.place === place)
    if (!from) return
    drag(place, from.x + dx, from.y + dy)
    clearTimeout(timers.get(key)?.timer)
    timers.set(key, { id, place, timer: setTimeout(() => void settle(place, id), KEY_SAVE_MS) })
  }
  /** Save the nudges that are still waiting (the tab closes, another pin or record is chosen). */
  function flush() {
    for (const { id, place, timer } of timers.values()) {
      clearTimeout(timer)
      void settle(place, id)
    }
    timers.clear()
  }
  /** Take a pin off the map. Says whether it was done. */
  async function remove(place: string) {
    const id = idOf()
    const done = await save((s) => unpinPlace(s, id, place), id)
    if (done) {
      if (selected.value === place) selected.value = undefined
      await edits.announce(`“${titleOf(place)}” is off the map.`)
    }
    return done
  }

  const title = computed(() => record.value?.meta.title ?? '')
  const titleOf = (id: string) => records.value.find((r) => r.meta.id === id)?.meta.title ?? ''
  const placingTitle = computed(() => (placing.value ? titleOf(placing.value) : ''))
  const pinnedHere = (place: string) => pinned.value.has(place)

  /** The places to choose from: those inside this one first, then the others of the universe. */
  const candidates = computed(() => {
    const inside = placeWithin(records.value, idOf())
    const places = records.value
      .filter((r) => (r.meta.type === 'place' || r.meta.type === 'world') && r.meta.id !== idOf())
      .map((r) => ({
        id: r.meta.id,
        title: r.meta.title,
        kind: r.meta.kind?.trim() || undefined,
        inside: inside.has(r.meta.id),
        pinned: pinnedHere(r.meta.id),
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
    return { inside: places.filter((p) => p.inside), elsewhere: places.filter((p) => !p.inside) }
  })
  /** The places directly inside this one that have no pin yet. */
  const notPinned = computed(() =>
    placeChildren(records.value, idOf()).filter((c) => !pinnedHere(c.id)),
  )
  /** The place this one sits inside, when that has a map of its own. */
  const parentMap = computed(() => {
    const parent = placeAncestors(records.value, idOf()).at(-1)
    const r = parent && records.value.find((x) => x.meta.id === parent.id)
    return parent && hasPicture(r?.meta.map) ? parent : undefined
  })

  /** What a pin's popover shows. */
  function about(place: string) {
    const r = records.value.find((x) => x.meta.id === place)
    const bookOf = (s: { meta: { chapter: string }; book?: string }) =>
      s.book ?? ws.data?.chapters.find((c) => c.id === s.meta.chapter)?.book
    const books = new Set(ws.universe?.books ?? [])
    return {
      title: r?.meta.title ?? '',
      kind: r?.meta.kind?.trim() || undefined,
      hasMap: hasPicture(r?.meta.map),
      scenes: scenesSetHere(
        records.value,
        (ws.data?.scenes ?? []).filter((s) => books.has(bookOf(s) ?? '')),
        place,
        bookOf,
      ),
    }
  }

  return {
    record,
    title,
    error,
    canEdit,
    hasMap,
    pictureGone,
    mapId,
    editing,
    selected,
    placing,
    placingTitle,
    pins,
    pinnedHere,
    candidates,
    notPinned,
    parentMap,
    about,
    busy: media.busy,
    choosePicture,
    addPicture,
    removeMap,
    drop,
    drag,
    settle,
    nudge,
    flush,
    remove,
    openPlace: (id: string) => nav.openRecord(ws.bookId ?? '', id),
    openMapOf: (id: string) => nav.openRecord(ws.bookId ?? '', id, 'map'),
    openScene: (bookId: string, sceneId: string) => nav.openScene(bookId, sceneId),
  }
}
