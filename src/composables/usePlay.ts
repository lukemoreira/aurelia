// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref } from 'vue'
import { readableParagraphs } from '@/domain/prose'
import { playBack, playChoose, playJump, playStart, type StoryGraph } from '@/domain/story-graph'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * Play mode: read the story from its start, pick a choice, go back, start again. Nothing is
 * written: the path taken is only in memory, and the text is shown as it is stored.
 */
export function usePlay(graph: () => StoryGraph | undefined) {
  const ws = useWorkspaceStore()
  const active = ref(false)
  const taken = ref<string[]>([])

  // A scene that has gone since (another device, a restore) ends the path where it was last whole.
  const path = computed(() => {
    const g = graph()
    const whole = taken.value.findIndex((id) => !g?.nodes.has(id))
    return whole < 0 ? taken.value : taken.value.slice(0, whole)
  })
  const scene = computed(() => graph()?.nodes.get(path.value.at(-1) ?? ''))
  const steps = computed(() =>
    path.value.map((id, i) => ({ id, index: i, title: graph()?.nodes.get(id)?.title ?? '' })),
  )
  const paragraphs = computed(() => {
    const id = scene.value?.id
    return readableParagraphs(ws.data?.scenes.find((s) => s.meta.id === id)?.body ?? '')
  })
  const options = computed(() => scene.value?.choices ?? [])
  const ended = computed(() => scene.value?.ending === true)
  /** A scene with no way on that is not an ending: the story stops, and the reader is told. */
  const stuck = computed(
    () => !!scene.value && !ended.value && !options.value.some((c) => !c.broken),
  )

  /** From the start, or from a scene the author picked ("Play from here"). */
  function start(from?: string) {
    const g = graph()
    taken.value = g ? (from && g.nodes.has(from) ? [from] : playStart(g)) : []
    active.value = true
  }
  const stop = () => (active.value = false)
  const choose = (choice: string) => {
    const g = graph()
    if (g) taken.value = playChoose(g, path.value, choice)
  }
  const back = () => (taken.value = playBack(path.value))
  const jump = (index: number) => (taken.value = playJump(path.value, index))

  return {
    active,
    path,
    scene,
    steps,
    paragraphs,
    options,
    ended,
    stuck,
    start,
    stop,
    choose,
    back,
    jump,
  }
}
