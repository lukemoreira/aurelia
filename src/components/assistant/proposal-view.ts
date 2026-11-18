// SPDX-License-Identifier: AGPL-3.0-or-later
// What a suggestion's card shows: its heading, and its changes as word diffs, each with a label when
// the suggestion touches several named things (story-base sections, a character's details).
import type { Proposal } from '@/domain/proposals'
import { RECORD_INFO } from '@/domain/record-types'
import { BASE_SECTIONS } from '@/domain/story-base'
import { diffWords, type DiffPart } from '@/domain/word-diff'
import type { Backlink } from '@/index/types'

export function targetOf(p: Proposal): string {
  if (p.kind === 'edit') return p.sceneTitle
  if (p.kind === 'scene') return `New scene in this chapter: “${p.title}”`
  if (p.kind === 'base') return `Story base of “${p.bookTitle}”`
  if (p.kind === 'delete-record')
    return `Delete ${RECORD_INFO[p.recordType].label.toLowerCase()}: “${p.title}”`
  return `New character: “${p.name}”`
}

/** Why a suggestion can no longer be accepted, in words. */
export const outOfDateWords = (p: Proposal) =>
  p.kind === 'character'
    ? 'Out of date: a character with this name is already in this world. Reject it.'
    : p.kind === 'delete-record'
      ? 'Out of date: this record was changed or deleted after this was suggested. Ask again, or reject it.'
      : 'Out of date: the text changed after this was suggested. Ask again, or reject it.'

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** What a delete card says beyond its why: where the record goes, and what links to it. */
export function deleteWords(backlinks: readonly Backlink[]): string {
  const linked = backlinks.filter((b) => b.links)
  const scenes = linked.filter((b) => b.from.kind === 'scene').length
  const records = linked.length - scenes
  const from = [scenes && count(scenes, 'scene'), records && count(records, 'record')]
    .filter(Boolean)
    .join(' and ')
  return `Accept moves it to Recently deleted, where you can bring it back.${
    from
      ? ` ${from} ${linked.length === 1 ? 'links' : 'link'} to it: those links stop working until it is back.`
      : ''
  }`
}

const FIELD_LABEL = new Map<string, string>(
  RECORD_INFO.character.fields.map((f) => [f.key, f.label]),
)

export function diffsOf(p: Proposal): { label?: string; parts: DiffPart[] }[] {
  if (p.kind === 'edit') return p.changes.map((c) => ({ parts: diffWords(c.before, c.after) }))
  if (p.kind === 'scene') return [{ parts: diffWords('', p.text) }]
  if (p.kind === 'delete-record') return []
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
