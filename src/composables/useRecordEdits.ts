// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRouter } from 'vue-router'
import { RECORD_INFO } from '@/domain/record-types'
import type { RecordType } from '@/domain/schema/record'
import { addRecord } from '@/storage/record-actions'
import { viewPath } from '@/router'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

/** "New character", "New place"…: asks for a name, makes the record, and opens its sheet in World. */
export function useRecordEdits() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const router = useRouter()

  /** `scope`: shared by the universe, or private to the open book. */
  function newRecord(type: RecordType, scope: 'universe' | 'book' = 'universe') {
    const session = ws.session
    const universe = ws.universe
    const book = ws.book
    if (!session || !universe || !book) return
    const word = RECORD_INFO[type].label.toLowerCase()
    edits.ask = {
      title: `New ${word}`,
      description:
        scope === 'book'
          ? `Only in “${book.title}”.`
          : `Shared by everything in “${universe.title}”.`,
      confirm: `Create ${word}`,
      initial: '',
      run: async (title) => {
        const id = await addRecord(session, {
          type,
          title,
          universeId: universe.id,
          ...(scope === 'book' ? { bookId: book.id } : {}),
        })
        await router.push({ path: viewPath(book.id, 'world'), query: { record: id } })
      },
    }
  }

  return { newRecord }
}
