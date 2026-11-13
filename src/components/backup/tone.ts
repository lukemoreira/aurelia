// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Tone } from '@/backup/words'

/** The classes of a tag on the Backup screen's cards. One map, so the two cards cannot drift. */
export const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-raised text-ink-2',
}
