// SPDX-License-Identifier: AGPL-3.0-or-later
// The pins on a place's map (ADR-0017). Each is one change to the place's own file, worked out inside the
// session's turn from the file as it is then, so a change made meanwhile (another device, a reload) is kept.
import { addPin, movePin, removePin } from '@/domain/place-maps'
import { StorageError } from './errors'
import { parseFrontmatter, splitDocument } from './frontmatter'
import { setDetails } from './outline-actions'
import type { WorkspaceSession } from './session'

const gone = () => new StorageError('other', 'That is no longer in the workspace.')

/**
 * The `pins` list of a record as its file has it now: every entry, those that could not be read too.
 * The edit makes the next list; nothing it leaves alone is changed, and a `pins` that is not a list is replaced.
 */
async function changePins(
  s: WorkspaceSession,
  holder: string,
  change: (raw: unknown, places: Set<string>) => unknown[],
) {
  await s.exclusive(async () => {
    const path = s.pathOf(holder)
    const text = path === undefined ? undefined : s.current(path)
    const record = s.data.records.find((r) => r.meta.id === holder)
    const parts = text === undefined ? null : splitDocument(text)
    if (!record || !parts) throw gone()
    const raw = (parseFrontmatter(parts.yaml) as Record<string, unknown>).pins
    const places = new Set(
      s.data.records
        .filter((r) => r.meta.type === 'place' || r.meta.type === 'world')
        .map((r) => r.meta.id),
    )
    const next = change(raw, places)
    await s.setFields(holder, { pins: next.length ? next : undefined })
    await s.flushPaths([path ?? ''])
    // A file changed elsewhere is left in conflict with this text still waiting: that is not saved.
    if (path !== undefined && s.pipeline.isBusy(path))
      throw new StorageError(
        'other',
        'Aurelia could not save that yet. Your changes are kept safe and it will try again.',
      )
  })
}

/** Put `place` on the map of `holder` at x, y (a place already there is moved). */
export const pinPlace = (
  s: WorkspaceSession,
  holder: string,
  place: string,
  x: number,
  y: number,
) =>
  changePins(s, holder, (raw, places) => {
    if (place === holder)
      throw new StorageError('other', 'A place cannot be pinned on its own map.')
    if (!places.has(place)) throw gone() // deleted since it was chosen
    return addPin(raw, place, x, y, holder)
  })

/** Another position for the pin of `place`. */
export const movePinOf = (
  s: WorkspaceSession,
  holder: string,
  place: string,
  x: number,
  y: number,
) => changePins(s, holder, (raw) => movePin(raw, place, x, y))

/** Take the pin of `place` off the map of `holder`. */
export const unpinPlace = (s: WorkspaceSession, holder: string, place: string) =>
  changePins(s, holder, (raw) => removePin(raw, place))

/** The picture used as the map (none takes the map away, and every pin on it). */
export const setMapPicture = (s: WorkspaceSession, holder: string, picture: string | undefined) =>
  setDetails(s, holder, picture ? { map: picture } : { map: undefined, pins: undefined })
