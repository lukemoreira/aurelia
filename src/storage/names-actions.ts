// SPDX-License-Identifier: AGPL-3.0-or-later
import { setDetails } from './outline-actions'
import type { WorkspaceSession } from './session'

/**
 * "Not a name" (ADR-0010): put these places in the scene's `ignoreNames`. Only that line of the
 * scene's details changes; the text is not touched, and a place already there is not added again.
 */
export async function addIgnoredNames(
  s: WorkspaceSession,
  sceneId: string,
  keys: string[],
): Promise<void> {
  const known = s.data.scenes.find((x) => x.meta.id === sceneId)?.meta.ignoreNames ?? []
  const next = Array.from(new Set([...known, ...keys]))
  if (next.length === known.length) return
  await setDetails(s, sceneId, { ignoreNames: next })
}
