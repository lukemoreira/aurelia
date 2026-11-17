// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch } from 'vue'
import { versionWhen } from '@/backup/words'
import { wordsFor } from '@/storage/errors'
import {
  compareScenes,
  inTimeOrder,
  sceneDiff,
  sceneFilesNow,
  sceneFilesOf,
  type SceneChange,
} from '@/storage/snapshot-compare'
import { snapshotName, snapshotRef } from '@/storage/snapshot-words'
import type { Snapshot } from '@/storage/snapshots'
import { useWorkspaceStore } from '@/stores/workspace'

const NOW = 'now'
const label = (s: Snapshot) => `${snapshotName(s)} · ${versionWhen(new Date(s.at), Date.now())}`

/**
 * A snapshot read against the text now, or against another snapshot: scene by scene (or one scene,
 * when `sceneId` is given), the older text first. Nothing here writes.
 */
export function useHistoryCompare(
  snapshot: () => Snapshot | undefined,
  others: () => Snapshot[],
  sceneId: () => string | undefined,
) {
  const ws = useWorkspaceStore()
  const against = ref(NOW)
  const rows = shallowRef<SceneChange[]>([])
  const picked = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** Which side is which, in words: "the snapshot “X”" / "the text now". */
  const sides = ref({ older: '', newer: '' })

  const options = computed(() => [
    { value: NOW, label: 'The text now' },
    ...others()
      .filter((s) => s.id !== snapshot()?.id && s.complete)
      .map((s) => ({ value: s.id, label: label(s) })),
  ])

  async function load() {
    const snap = snapshot()
    const session = ws.session
    rows.value = []
    error.value = ''
    if (!snap || !session) return
    loading.value = true
    try {
      const other = against.value === NOW ? undefined : others().find((s) => s.id === against.value)
      const [first, second] = other ? inTimeOrder(snap, other) : [snap, undefined]
      const older = await sceneFilesOf(session.adapter, first)
      const newer = second
        ? await sceneFilesOf(session.adapter, second)
        : sceneFilesNow(session, snap.book)
      const only = (m: Map<string, string>) => {
        const id = sceneId()
        return id ? new Map([...m].filter(([p]) => p.endsWith(`/${id}.md`))) : m
      }
      sides.value = {
        older: snapshotRef(first),
        newer: second ? snapshotRef(second) : 'the text now',
      }
      rows.value = compareScenes({ older: only(older), newer: only(newer) })
      picked.value =
        sceneId() || rows.value.length === 1
          ? (rows.value[0]?.id ?? null)
          : (rows.value.find((r) => r.state === 'changed')?.id ?? null)
    } catch (e) {
      error.value = wordsFor(e, 'These could not be compared. Nothing was changed.')
    } finally {
      loading.value = false
    }
  }
  watch([snapshot, against], load, { immediate: true })

  const current = computed(() => rows.value.find((r) => r.id === picked.value))
  /** The diff of the scene picked, made only when it is looked at. */
  const diff = computed(() => (current.value ? sceneDiff(current.value) : undefined))
  const sameCount = computed(() => rows.value.filter((r) => r.state === 'same').length)

  return { against, options, rows, picked, current, diff, sameCount, sides, loading, error }
}
