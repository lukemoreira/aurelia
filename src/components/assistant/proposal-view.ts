// SPDX-License-Identifier: AGPL-3.0-or-later
// What a suggestion's card shows: its heading, and its changes as word diffs, each with a label when
// the suggestion touches several named things (story-base sections, a character's details).
import type { Proposal } from '@/domain/proposals'
import { RECORD_INFO } from '@/domain/record-types'
import { BASE_SECTIONS } from '@/domain/story-base'
import { diffWords, type DiffPart } from '@/domain/word-diff'

export function targetOf(p: Proposal): string {
  if (p.kind === 'edit') return p.sceneTitle
  if (p.kind === 'scene') return `New scene in this chapter: “${p.title}”`
  if (p.kind === 'base') return `Story base of “${p.bookTitle}”`
  return `New character: “${p.name}”`
}

/** Why a suggestion can no longer be accepted, in words. */
export const outOfDateWords = (p: Proposal) =>
  p.kind === 'character'
    ? 'Out of date: a character with this name is already in this world. Reject it.'
    : 'Out of date: the text changed after this was suggested. Ask again, or reject it.'

const FIELD_LABEL = new Map<string, string>(
  RECORD_INFO.character.fields.map((f) => [f.key, f.label]),
)

export function diffsOf(p: Proposal): { label?: string; parts: DiffPart[] }[] {
  if (p.kind === 'edit') return p.changes.map((c) => ({ parts: diffWords(c.before, c.after) }))
  if (p.kind === 'scene') return [{ parts: diffWords('', p.text) }]
  if (p.kind === 'base')
    return BASE_SECTIONS.flatMap((s) => {
      const c = p.sections[s.key]
      return c ? [{ label: s.label, parts: diffWords(c.before, c.after) }] : []
    })
  return Object.entries({ summary: p.summary, ...p.fields }).flatMap(([k, v]) =>
    v?.trim()
      ? [
          {
            label: k === 'summary' ? 'Summary' : (FIELD_LABEL.get(k) ?? k),
            parts: diffWords('', v),
          },
        ]
      : [],
  )
}
