// SPDX-License-Identifier: AGPL-3.0-or-later
// Names the UI and the index layer share. Plain data: no Vue, no components.

/** Every icon the app draws. The paths live in components/ui/icons.ts, which must cover all. */
export type IconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'chevrons-up-down'
  | 'menu'
  | 'book'
  | 'branch'
  | 'part'
  | 'chapter'
  | 'scene'
  | 'user'
  | 'place'
  | 'item'
  | 'event'
  | 'arc'
  | 'lore'
  | 'research'
  | 'search'
  | 'plus'
  | 'close'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'folder'
  | 'cloud'
  | 'inbox'
  | 'panel-left'
  | 'panel-right'
  | 'focus'
  | 'play'
  | 'link'
  | 'check'
  | 'warning'
  | 'info'
  | 'undo'
  | 'redo'
  | 'list'
  | 'checklist'
  | 'quote'
  | 'callout'
  | 'embed'
  | 'filter'
  | 'flag'
  | 'calendar'
  | 'pin'
  | 'globe'
  | 'write'
  | 'plan'
  | 'continuity'

export type StatusKind = 'idea' | 'outline' | 'draft' | 'revised' | 'final'

export const STATUS_LABELS: Record<StatusKind, string> = {
  idea: 'Idea',
  outline: 'Outline',
  draft: 'Draft',
  revised: 'Revised',
  final: 'Final',
}
