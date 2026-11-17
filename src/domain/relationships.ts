// SPDX-License-Identifier: AGPL-3.0-or-later
// Relationships between records. One is stored on the record that lists it (`relationships:` in its
// file, `{ with, type }`) and is shown on both: the other record's sheet lists it too, so a
// relationship made from either end is seen from both.
import type { RecordType } from './schema/record'
import type { RecordDoc } from './workspace-data'

export interface RelationshipRow {
  /** The record on the other end. */
  other: { id: string; title: string; type: RecordType }
  /** What the author wrote: "mentor", "creditor → uneasy ally". */
  type: string
  /** The record whose file holds it, and which of its entries it is: where Edit and Remove write. */
  holder: string
  index: number
  /** The record the entry points at (the other record on an own row; this record on the other side): what Edit and Remove check before they write. */
  with: string
  /** Listed on this record's own sheet, or on the other record's (and shown here as well). */
  side: 'own' | 'other'
}

/** The relationships of `id`: those it lists, then those other records list about it. Ones that point at nothing are left out. */
export function relationshipsOf(records: Pick<RecordDoc, 'meta'>[], id: string): RelationshipRow[] {
  const by = new Map(records.map((r) => [r.meta.id, r.meta]))
  const out: RelationshipRow[] = []
  const add = (holder: string, side: RelationshipRow['side'], otherId: string) => {
    const other = by.get(otherId)
    const list = by.get(holder)?.relationships ?? []
    list.forEach((rel, index) => {
      if (rel.with !== (side === 'own' ? otherId : id) || !other) return
      if (out.some((r) => r.holder === holder && r.index === index)) return
      out.push({
        other: { id: other.id, title: other.title, type: other.type },
        type: rel.type,
        holder,
        index,
        with: rel.with,
        side,
      })
    })
  }
  const mine = by.get(id)?.relationships ?? []
  for (const rel of new Set(mine.map((r) => r.with))) add(id, 'own', rel)
  for (const r of records)
    if (r.meta.id !== id && (r.meta.relationships ?? []).some((x) => x.with === id))
      add(r.meta.id, 'other', r.meta.id)
  return out
}
