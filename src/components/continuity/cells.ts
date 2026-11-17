// SPDX-License-Identifier: AGPL-3.0-or-later
// How a cell of the presence map and an arc lane looks. The look only helps: every cell also says
// what it is in words (a table cell's text), and a finding is a mark and an outline, not a colour alone.
import type { LaneCell, PresenceCell } from '@/domain/continuity-views'

/** A character's or arc's colour token, as CSS; plain ink for one with no colour. */
export const tone = (t?: string) => (t ? `var(--${t})` : 'var(--ink-3)')

export const cellClass =
  'mx-auto flex items-center justify-center rounded-[5px] text-xs font-semibold text-ink'

const mix = (colour: string, percent: number) =>
  `color-mix(in srgb, ${colour} ${percent}%, transparent)`

/** † for a death, → for someone who leaves, ! for a finding. */
export const glyph = (cell: PresenceCell) =>
  cell.finding ? '!' : cell.exit ? (cell.exit === 'dies' ? '†' : '→') : ''

export function cellStyle(cell: PresenceCell, colour: string): Record<string, string> {
  if (cell.finding)
    return {
      background: 'var(--danger-soft)',
      border: '2px solid var(--danger)',
      color: 'var(--danger)',
    }
  if (cell.state === 'pov') return { background: colour, color: 'var(--on-accent)' }
  if (cell.state === 'on') return { background: mix(colour, 38) }
  if (cell.state === 'mentioned') return { border: `1.5px solid ${mix(colour, 75)}` }
  return { background: 'var(--canvas)' }
}

/** A beat is a dot on the lane's line, a move is the line, a silence is a dashed warning line (no mark but the line). */
export function laneGlyph(cell: LaneCell) {
  return cell.kind === 'beat' ? '●' : ''
}

export function laneStyle(cell: LaneCell, colour: string): Record<string, string> {
  if (cell.kind === 'none') return {}
  // A silence is a dashed line in the warning colour; a beat or a move is the arc's own solid one.
  if (cell.kind === 'silent')
    return {
      color: 'var(--warn)',
      background:
        'repeating-linear-gradient(90deg, var(--warn) 0 5px, transparent 5px 9px) center / 100% 2px no-repeat',
    }
  return {
    color: colour,
    background: `linear-gradient(${colour}, ${colour}) center / 100% 2px no-repeat`,
  }
}
