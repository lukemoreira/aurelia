// SPDX-License-Identifier: AGPL-3.0-or-later
import { nextTick, onMounted, ref, watch } from 'vue'
import type { useStoryMap } from './useStoryMap'

type MapState = ReturnType<typeof useStoryMap>

/**
 * The story map's surface: drag the background to pan, Ctrl/⌘ + wheel to zoom, arrow keys to
 * walk from scene to scene (the selection follows), Enter to open the scene, Home for the start.
 */
export function useMapCanvas(map: MapState) {
  const scroller = ref<HTMLElement | null>(null)

  const nodeEl = (id: string) =>
    scroller.value?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`) ?? null
  async function show(id: string, focus = false) {
    await nextTick()
    const el = nodeEl(id)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focus) el.focus({ preventScroll: true })
  }
  // A scene picked anywhere (the problems list, a choice) is brought into view.
  watch(map.selected, (id) => id && void show(id))

  onMounted(() => {
    const width = scroller.value?.clientWidth
    if (width) map.fit(width - 40)
  })

  let drag: { x: number; y: number; left: number; top: number } | undefined
  function pointerdown(e: PointerEvent) {
    const el = scroller.value
    if (
      !el ||
      e.pointerType !== 'mouse' ||
      e.button !== 0 ||
      (e.target as HTMLElement).closest('[data-node]')
    )
      return
    drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  function pointermove(e: PointerEvent) {
    const el = scroller.value
    if (!drag || !el) return
    el.scrollLeft = drag.left - (e.clientX - drag.x)
    el.scrollTop = drag.top - (e.clientY - drag.y)
  }
  const pointerup = () => (drag = undefined)
  function wheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    map.zoomBy(e.deltaY < 0 ? 1 : -1)
  }

  const DIRECTIONS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  } as const
  function onKey(e: KeyboardEvent, id: string) {
    const dir = DIRECTIONS[e.key as keyof typeof DIRECTIONS]
    if (dir && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const next = map.step(id, dir)
      if (next) void show(next, true)
    } else if (e.key === 'Home' && map.graph.value?.start) {
      e.preventDefault()
      map.select(map.graph.value.start)
      void show(map.graph.value.start, true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void map.open(id)
    }
  }

  return { scroller, pointerdown, pointermove, pointerup, wheel, onKey, show }
}
