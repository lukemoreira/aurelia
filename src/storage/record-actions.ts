// SPDX-License-Identifier: AGPL-3.0-or-later
import { RECORD_INFO } from '@/domain/record-types'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import type { Alias, RecordType } from '@/domain/schema/record'
import { newId } from '@/domain/ids'
import { checkTitle } from '@/domain/titles'
import { StorageError } from './errors'
import { newHead } from './frontmatter'
import { recordPath } from './paths'
import type { WorkspaceSession } from './session'

const ARC_COLOURS = ['ember', 'tide', 'moss', 'plum'] as const

/**
 * A new record, shared by the universe or (with `bookId`) private to one book. One file; nothing
 * else points at it, so there is no list to keep in step.
 */
export function addRecord(
  s: WorkspaceSession,
  opts: { type: RecordType; title: string; universeId: string; bookId?: string },
): Promise<string> {
  let id = ''
  return s
    .exclusive(async () => {
      const checked = checkTitle(opts.title)
      if (!checked.ok) throw new StorageError('other', checked.error || 'Give it a name.')
      if (!s.data.universes.some((u) => u.id === opts.universeId))
        throw new StorageError('other', 'That universe is no longer in the workspace.')
      const info = RECORD_INFO[opts.type]
      id = newId(info.prefix)
      for (let tries = 0; s.pathOf(id) && tries < 10; tries++) id = newId(info.prefix)
      if (s.pathOf(id)) throw new StorageError('other', 'Aurelia could not make a new ID.')
      const scope = opts.bookId ? `book:${opts.bookId}` : 'universe'
      // An arc starts with a colour, the next of the palette, so the plan's cards tell arcs apart at once.
      const arcs = s.data.records.filter(
        (r) => r.meta.type === 'arc' && r.universe === opts.universeId,
      )
      const color = opts.type === 'arc' ? ARC_COLOURS[arcs.length % ARC_COLOURS.length] : undefined
      await s.create([
        {
          path: recordPath(opts.universeId, scope, info.folder, id),
          text: newHead({
            title: checked.title,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            id,
            type: opts.type,
            scope,
            ...(color ? { color } : {}),
          }),
        },
      ])
    })
    .then(() => id)
}

/**
 * The names a record goes by, as the file keeps them (ADR-0010): trimmed, none empty, none twice,
 * and `match` written only when it is not the default. Nothing at all takes the key away.
 */
export function aliasesPatch(list: Alias[]): Alias[] | undefined {
  const seen = new Set<string>()
  const clean: Alias[] = []
  for (const a of list) {
    const text = a.text.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    const { text: _, match, ...unknown } = a // keys this version does not know are kept (ADR-0003 rule 6)
    void _
    clean.push({ text, ...(match && match !== 'auto' ? { match } : {}), ...unknown })
  }
  return clean.length ? clean : undefined
}
