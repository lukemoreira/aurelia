// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import {
  clampView,
  fitSize,
  fitView,
  fractionAt,
  isOnPicture,
  panBy,
  revealShift,
  wheelPixels,
  wheelFactor,
  zoomAt,
  type MapView,
  type Size,
} from '@/domain/map-view'

const TAP_SLOP = 4 // pixels a pointer may move and still be a tap

/**
 * The zoom and pan of a map picture in its frame (ADR-0017): buttons, the wheel, a trackpad's pinch, a drag
 * to pan and a two-finger pinch, all with pointer events. A press that did not move is a tap (`onTap`, in
 * client pixels). The arithmetic is `domain/map-view.ts`.
 */
export function usePlaceMapView(
  frameEl: Ref<HTMLElement | undefined>,
  stageEl: Ref<HTMLElement | undefined>,
  image: Ref<Size>,
  onTap: (clientX: number, clientY: number) => void,
) {
  const frame = ref<Size>({ w: 0, h: 0 })
  const fit = computed(() => fitSize(frame.value, image.value))
  const zoomed = ref<MapView>({ k: 1, x: 0, y: 0 })
  // Read through the clamp, so a frame or a picture that changes size never leaves it out of place.
  const view = computed(() => clampView(zoomed.value, frame.value, fit.value))

  let observer: ResizeObserver | undefined
  const measure = () => {
    const r = frameEl.value?.getBoundingClientRect()
    if (r) frame.value = { w: r.width, h: r.height }
  }
  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined' && frameEl.value) {
      observer = new ResizeObserver(measure)
      observer.observe(frameEl.value)
    }
  })
  onBeforeUnmount(() => observer?.disconnect())

  const local = (clientX: number, clientY: number) => {
    const r = frameEl.value?.getBoundingClientRect()
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) }
  }
  const zoomTo = (k: number, px = frame.value.w / 2, py = frame.value.h / 2) =>
    (zoomed.value = zoomAt(view.value, k, px, py, frame.value, fit.value))
  const zoomIn = () => zoomTo(view.value.k * 1.5)
  const zoomOut = () => zoomTo(view.value.k / 1.5)
  const reset = () => {
    zoomed.value = fitView(frame.value, fit.value)
    // Nothing may have scrolled the frame itself (a focused pin once did): Fit puts the picture back.
    if (frameEl.value) [frameEl.value.scrollLeft, frameEl.value.scrollTop] = [0, 0]
  }
  /** A plain wheel scrolls the page; Ctrl or Cmd with it (and a trackpad's pinch, which says Ctrl) zooms. */
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const at = local(e.clientX, e.clientY)
    const pixels = wheelPixels(e.deltaY, e.deltaMode, frame.value.h)
    zoomTo(view.value.k * wheelFactor(pixels, e.ctrlKey), at.x, at.y)
  }

  const pointers = new Map<number, { x: number; y: number }>()
  let start = { x: 0, y: 0 }
  let moved = false
  let pinch = { dist: 1, x: 0, y: 0 }
  const pair = () => {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  function onPointerDown(e: PointerEvent) {
    // A right-click or Ctrl-click is not a press (on a Mac a Ctrl-click can arrive as button 0, then a menu, and no release).
    if (e.pointerType === 'mouse' && (e.button !== 0 || e.ctrlKey)) return
    frameEl.value?.setPointerCapture?.(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) [start, moved] = [{ x: e.clientX, y: e.clientY }, false]
    else if (pointers.size === 2) [moved, pinch] = [true, pair()]
  }
  function onPointerMove(e: PointerEvent) {
    const before = pointers.get(e.pointerId)
    if (!before) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP) return
      moved = true
      zoomed.value = panBy(
        view.value,
        e.clientX - before.x,
        e.clientY - before.y,
        frame.value,
        fit.value,
      )
    } else if (pointers.size === 2) {
      const now = pair()
      const at = local(now.x, now.y)
      const zoomedIn = zoomAt(
        view.value,
        (view.value.k * now.dist) / pinch.dist,
        at.x,
        at.y,
        frame.value,
        fit.value,
      )
      zoomed.value = panBy(zoomedIn, now.x - pinch.x, now.y - pinch.y, frame.value, fit.value)
      pinch = now
    }
  }
  function onPointerUp(e: PointerEvent) {
    const tap = pointers.size === 1 && pointers.has(e.pointerId) && !moved
    pointers.delete(e.pointerId)
    if (tap) onTap(e.clientX, e.clientY)
  }
  // A pointer that is lost (cancelled, or its capture taken) must not leave the map thinking it is still down.
  const onPointerCancel = (e: PointerEvent) => void pointers.delete(e.pointerId)

  /** Where on the picture a point of the screen is (fractions 0..1). */
  const pictureRect = () =>
    stageEl.value?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1, height: 1 }
  const pointOn = (clientX: number, clientY: number) => fractionAt(pictureRect(), clientX, clientY)
  /** The same, but nothing for a point in the margin beside the picture. */
  const pointOnPicture = (clientX: number, clientY: number) =>
    isOnPicture(pictureRect(), clientX, clientY) ? pointOn(clientX, clientY) : undefined
  /** The middle of what is on screen, as a point of the picture. */
  const visibleCentre = () => {
    const v = view.value
    const { w, h } = fit.value
    if (!w || !h) return { x: 0.5, y: 0.5 } // the picture is not measured yet
    return fractionAt(
      { left: 0, top: 0, width: w * v.k, height: h * v.k },
      frame.value.w / 2 - v.x,
      frame.value.h / 2 - v.y,
    )
  }
  /** Where a point of the picture is in the frame, in pixels. */
  const screenOf = (x: number, y: number) => ({
    x: view.value.x + x * fit.value.w * view.value.k,
    y: view.value.y + y * fit.value.h * view.value.k,
  })

  /** Pan so a pin (a point of the picture) can be seen: its tip with room above it for its body. */
  function reveal(x: number, y: number) {
    const at = screenOf(x, y)
    const dx = revealShift(at.x, frame.value.w, 24)
    const dy = revealShift(at.y, frame.value.h, 24, 56)
    if (dx || dy) zoomed.value = panBy(view.value, dx, dy, frame.value, fit.value)
  }

  return {
    frame,
    fit,
    view,
    zoomIn,
    zoomOut,
    reset,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    pointOn,
    pointOnPicture,
    reveal,
    visibleCentre,
    screenOf,
  }
}
