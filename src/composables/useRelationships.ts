// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref } from 'vue'
import { RECORD_INFO } from '@/domain/record-types'
import { relationshipsOf, type RelationshipRow } from '@/domain/relationships'
import { wordsFor } from '@/storage/errors'
import { addRelationship, removeRelationship, renameRelationship } from '@/storage/world-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'

/** The relationships of one record: both those it lists and those others list about it, and how to change them. */
export function useRelationships(idOf: () => string) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const nav = useNavigation()
  const error = ref('')

  const rows = computed<RelationshipRow[]>(() => relationshipsOf(ws.data?.records ?? [], idOf()))

  /**
   * Who it can be related to: a record shared by the universe may only point at shared ones (a
   * private record would point nowhere in the other books); a book's own record may point at both.
   */
  const choices = computed(() => {
    const me = ws.data?.records.find((r) => r.meta.id === idOf())
    if (!me) return []
    return (ws.data?.records ?? [])
      .filter(
        (r) =>
          r.meta.id !== me.meta.id &&
          r.universe === me.universe &&
          (r.meta.scope === 'universe' || r.meta.scope === me.meta.scope),
      )
      .map((r) => ({
        value: r.meta.id,
        label: `${r.meta.title} · ${RECORD_INFO[r.meta.type].label}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  async function run(work: () => Promise<void>): Promise<boolean> {
    error.value = ''
    try {
      await work()
      return true
    } catch (e) {
      error.value = wordsFor(e, 'That did not work. Nothing was lost.')
      return false
    }
  }
  const session = () => ws.session

  return {
    rows,
    choices,
    error,
    canEdit: edit.canEdit,
    add: (other: string, type: string) =>
      run(async () => void (session() && (await addRelationship(session()!, idOf(), other, type)))),
    rename: (row: RelationshipRow, type: string) =>
      run(
        async () =>
          void (
            session() &&
            (await renameRelationship(session()!, row.holder, row.index, row.with, type))
          ),
      ),
    remove: (row: RelationshipRow) =>
      run(
        async () =>
          void (
            session() && (await removeRelationship(session()!, row.holder, row.index, row.with))
          ),
      ),
    open: (row: RelationshipRow) => nav.openTarget({ kind: 'record', id: row.other.id }),
  }
}
