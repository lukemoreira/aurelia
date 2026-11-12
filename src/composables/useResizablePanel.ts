// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, type UnwrapNestedRefs } from 'vue'
import { usePersisted } from './usePersisted'

interface PanelOptions {
  /** Where its size and collapsed state are saved on this device. */
  key: string
  initial: number
  min: number
  max: number
  /** The side of the screen the panel sits on: dragging grows it away from that edge. */
  side: 'left' | 'right'
  step?: number
}

interface PanelState {
  width: number
  collapsed: boolean
}
const isPanelState = (v: unknown): v is PanelState =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as PanelState).width === 'number' &&
  typeof (v as PanelState).collapsed === 'boolean'

/** A panel never takes more than this share of the window, however wide the screen it was sized on. */
const MAX_SHARE = 0.4
const viewportWidth = ref(typeof window === 'undefined' ? Infinity : window.innerWidth)
if (typeof window !== 'undefined')
  window.addEventListener('resize', () => (viewportWidth.value = window.innerWidth))

/** Width, collapsed state, drag and keyboard resizing for a side panel. Saved per device. */
export function useResizablePanel({
  key,
  initial,
  min,
  max: limit,
  side,
  step = 16,
}: PanelOptions) {
  const state = usePersisted<PanelState>(key, { width: initial, collapsed: false }, isPanelState)
  // A width saved on a big screen is cut down on a small one, and comes back when it grows again.
  const max = computed(() =>
    Math.max(min, Math.floor(Math.min(limit, viewportWidth.value * MAX_SHARE))),
  )
  const clamp = (n: number) => Math.min(max.value, Math.max(min, Math.round(n)))
  const width = computed({
    get: () => clamp(state.value.width),
    set: (n: number) => (state.value.width = clamp(n)),
  })
  const collapsed = computed({
    get: () => state.value.collapsed,
    set: (v: boolean) => (state.value.collapsed = v),
  })
  const resizing = ref(false)
  // Which way the arrow keys grow the panel.
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'

  let startX = 0
  let startWidth = 0

  function onKeydown(e: KeyboardEvent) {
    const amount = e.shiftKey ? step * 4 : step
    if (e.key === grow) width.value += amount
    else if (e.key === shrink) width.value -= amount
    else if (e.key === 'Home') width.value = min
    else if (e.key === 'End') width.value = max.value
    else return
    e.preventDefault()
  }
  function onPointerDown(e: PointerEvent) {
    resizing.value = true
    startX = e.clientX
    startWidth = width.value
    ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (!resizing.value) return
    const dx = e.clientX - startX
    width.value = startWidth + (side === 'left' ? dx : -dx)
  }
  function onPointerUp() {
    resizing.value = false
  }
  const toggle = () => (collapsed.value = !collapsed.value)

  return {
    width,
    collapsed,
    resizing,
    min,
    max,
    toggle,
    onKeydown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}

/** What a component sees when the panel is handed over through a Pinia store. */
export type ResizablePanel = UnwrapNestedRefs<ReturnType<typeof useResizablePanel>>
