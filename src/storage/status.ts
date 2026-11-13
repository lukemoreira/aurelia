// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SessionView } from './session'

/** What the status bar and the phone header say about saving, in plain words. */
export function saveWords(view: SessionView): string {
  if (view.readOnly) return 'Read-only'
  if (view.save.kind === 'conflict') return 'Changed outside Aurelia'
  if (view.permissionLost) return 'Folder not connected'
  if (view.save.kind === 'failed') return 'Save failed — will retry'
  if (view.save.kind === 'saving') return 'Saving…'
  return 'Saved'
}

/** True for the words that are not just routine progress: a screen reader should hear them. */
export const needsAttention = (view: SessionView) => !['Saved', 'Saving…'].includes(saveWords(view))

/** Why the workspace cannot be renamed right now, in plain words; null when it can. */
export function renameBlock(view: SessionView): string | null {
  if (view.newerVersion)
    return 'A newer version of Aurelia saved this workspace, so it is read-only here.'
  if (view.otherTab)
    return 'This workspace is open in another tab, which is the one that can change it.'
  if (view.settling)
    return 'Aurelia is still catching up after another tab let go. Try again in a moment.'
  return null
}
