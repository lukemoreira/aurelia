<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { modLabel } from '@/composables/useKeyboardShortcuts'
import { useMediaImage } from '@/composables/useMedia'
import { NUDGE, NUDGE_FAR } from '@/composables/usePlaceMap'
import { usePlaceMapView } from '@/composables/usePlaceMapView'
import { svgSize } from '@/domain/map-view'
import type { ShownPin } from '@/domain/place-maps'

/**
 * A map picture with its pins: zoom and pan, and pins that stay the same size on screen at any zoom. It
 * only draws and reports (a tap, a drag, an arrow key); what they do is the tab's. The pins are inside the
 * picture's own frame, placed in % of it, and scaled back by the zoom.
 */
const props = defineProps<{
  mapId: string
  alt: string
  pins: ShownPin[]
  editing: boolean
  /** A place is waiting for a click on the map. */
  placing?: boolean
  selected?: string
}>()
const emit = defineEmits<{
  select: [place: string | undefined]
  drop: [x: number, y: number]
  drag: [place: string, x: number, y: number]
  settle: [place: string]
  nudge: [place: string, dx: number, dy: number]
  /** The picture cannot be shown (its file is missing, or it is not an image the browser reads). */
  broken: []
}>()
const hintId = useId()
const frameEl = ref<HTMLElement>()
const stageEl = ref<HTMLElement>()
const { url, failed } = useMediaImage(() => props.mapId, 'full')
// A picture that says no size (an SVG with only a viewBox) is laid out as this, never as nothing.
const FALLBACK = { w: 1000, h: 700 }
const natural = ref({ w: 0, h: 0 })
watch(failed, (gone) => gone && emit('broken'), { immediate: true })
const size = computed(() => (natural.value.w && natural.value.h ? natural.value : FALLBACK))
const view = usePlaceMapView(frameEl, stageEl, size, (x, y) => {
  if (!props.placing) return emit('select', undefined)
  const at = view.pointOnPicture(x, y) // a click in the margin beside the picture drops nothing
  if (at) emit('drop', at.x, at.y)
})
const stage = computed(() => ({
  width: `${view.fit.value.w}px`,
  height: `${view.fit.value.h}px`,
  transform: `translate(${view.view.value.x}px, ${view.view.value.y}px) scale(${view.view.value.k})`,
  '--k': view.view.value.k,
}))
// The frame is as tall as the picture is for this width, up to a cap; only then is there room beside it.
const frameStyle = computed(() => ({ aspectRatio: `${size.value.w} / ${size.value.h}` }))
const onLoad = async (e: Event) => {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  if (natural.value.w && natural.value.h) return
  // An SVG with only a viewBox reports no size: read it from the file, so the pins and the margin check are
  // against the picture itself. If it says nothing, the picture is stretched to fill the fallback box exactly.
  try {
    const text = await (await fetch(img.src)).text()
    natural.value = svgSize(text) ?? natural.value
  } catch {
    /* the fallback box stands */
  }
}
/** The zoom buttons sit on the picture's own corner, not out in the margin of the frame. */
const controlsAt = computed(() => ({
  right: `${Math.max(0, (view.frame.value.w - view.fit.value.w) / 2) + 8}px`,
  top: `${Math.max(0, (view.frame.value.h - view.fit.value.h) / 2) + 8}px`,
}))
const names = ref(true)
/**
 * Each pin as it is on screen. A pin's body is above its point, so near the top of the frame it would be cut off:
 * there it points up instead (the stored position is not touched). Its label goes on the side that has room.
 */
const PIN_HEIGHT = 44
const LABEL_ROOM = 180
const drawn = computed(() =>
  props.pins.map((p) => {
    const at = view.screenOf(p.x, p.y)
    const room = view.frame.value.w - at.x
    return { ...p, up: at.y < PIN_HEIGHT, left: room < LABEL_ROOM && at.x > room }
  }),
)

// Dragging a pin (edit mode): a press that does not move is a click, which opens the pin. The pin keeps the
// distance it had from the pointer when it was grabbed, so it does not jump on the first move.
let dragging:
  | { id: number; place: string; x: number; y: number; dx: number; dy: number; moved: boolean }
  | undefined
let afterDrag = false
function pinDown(e: PointerEvent, p: ShownPin) {
  e.stopPropagation() // not the picture's pan
  afterDrag = false // a drag that ended without a click (cancelled) must not swallow this press
  // A second finger on another pin is not a second drag: the first one is the one being dragged.
  if (dragging || !props.editing || (e.pointerType === 'mouse' && (e.button !== 0 || e.ctrlKey)))
    return
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  const grab = view.pointOn(e.clientX, e.clientY)
  dragging = {
    id: e.pointerId,
    place: p.place,
    x: e.clientX,
    y: e.clientY,
    dx: p.x - grab.x,
    dy: p.y - grab.y,
    moved: false,
  }
}
function pinMove(e: PointerEvent) {
  if (dragging?.id !== e.pointerId) return
  if (!dragging.moved && Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) < 4) return
  dragging.moved = true
  const at = view.pointOn(e.clientX, e.clientY)
  emit('drag', dragging.place, at.x + dragging.dx, at.y + dragging.dy)
}
function pinUp(e: PointerEvent) {
  if (dragging?.id !== e.pointerId) return
  if (dragging?.moved) {
    afterDrag = true // the click that follows this release is the end of the drag, not a press
    emit('settle', dragging.place)
  }
  dragging = undefined
}
/** A cancelled drag: the pin is settled where it got to, and no click follows. */
function pinCancel(e: PointerEvent) {
  if (dragging?.id !== e.pointerId) return
  if (dragging?.moved) emit('settle', dragging.place)
  dragging = undefined
}
function pinClick(place: string) {
  if (afterDrag) afterDrag = false
  else emit('select', place)
}
function pinKey(e: KeyboardEvent, place: string) {
  afterDrag = false // a key is not the click of a drag
  if (e.key === 'Escape') return emit('select', undefined)
  const step = e.shiftKey ? NUDGE_FAR : NUDGE
  const by: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const move = by[e.key]
  if (!props.editing || !move) return
  e.preventDefault()
  emit('nudge', place, ...move)
}

/** The keyboard reached a pin that is out of sight: pan to it (a click on a pin that is in sight moves nothing). */
function onPinFocus(e: FocusEvent, p: ShownPin) {
  if ((e.target as HTMLElement).matches(':focus-visible')) view.reveal(p.x, p.y)
}
/** Put focus on a pin (after it is dropped, so the arrow keys move it). */
async function focusPin(place: string) {
  await nextTick()
  frameEl.value?.querySelector<HTMLElement>(`[data-pin="${place}"]`)?.focus({ preventScroll: true })
}
const openPin = computed(() => props.pins.find((p) => p.place === props.selected))
/** Where the open pin is on screen, to put its popover beside it. */
const anchor = computed(() => {
  const p = openPin.value
  if (!p) return undefined
  const at = view.screenOf(p.x, p.y)
  const { w, h } = view.frame.value
  const x = Math.min(Math.max(at.x, 0), w)
  const y = Math.min(Math.max(at.y, 0), h)
  return { x, y, below: y < h / 2 }
})
defineExpose({
  focusPin,
  /** Pan so a pin can be seen (a card opened for a pin that is out of sight would point at nothing). */
  reveal: (place: string) => {
    const p = props.pins.find((x) => x.place === place)
    if (p) view.reveal(p.x, p.y)
  },
  visibleCentre: () => view.visibleCentre(),
})
const control =
  'flex h-8 min-w-8 items-center justify-center rounded-control border border-line-2 bg-surface px-2 text-[13px] font-medium text-ink hover:bg-raised pointer-coarse:h-11 pointer-coarse:min-w-11'
</script>

<template>
  <div class="relative">
    <div
      ref="frameEl"
      role="group"
      :aria-label="`Map: ${alt}`"
      :style="frameStyle"
      :class="[
        'relative max-h-[min(70vh,560px)] min-h-48 w-full select-none overflow-clip rounded-card border border-line bg-raised',
        // One finger on a map that fills a phone must still scroll the page: only a zoomed map takes the drag.
        view.view.value.k > 1 ? 'touch-none' : 'touch-pan-y',
        placing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
      ]"
      @pointerdown="view.onPointerDown"
      @pointermove="view.onPointerMove"
      @pointerup="view.onPointerUp"
      @pointercancel="view.onPointerCancel"
      @lostpointercapture="view.onPointerCancel"
      @wheel="view.onWheel"
    >
      <!-- The controls come before the pins, so the keyboard reaches them first. A press on them is not a pan. -->
      <div class="absolute z-10 flex gap-1" :style="controlsAt" @pointerdown.stop>
        <button type="button" :class="control" aria-label="Zoom in" @click="view.zoomIn()">
          +
        </button>
        <button type="button" :class="control" aria-label="Zoom out" @click="view.zoomOut()">
          −
        </button>
        <button type="button" :class="control" @click="view.reset()">Fit</button>
        <button type="button" :class="control" :aria-pressed="names" @click="names = !names">
          Names
        </button>
      </div>

      <div ref="stageEl" class="absolute left-0 top-0 origin-top-left" :style="stage">
        <img
          v-if="url"
          :src="url"
          alt=""
          draggable="false"
          class="pointer-events-none size-full select-none object-fill"
          @load="onLoad"
          @error="emit('broken')"
        />
        <!-- A pin sits at a point of the picture (in %), and is scaled back by the zoom so it stays the same size. -->
        <div
          v-for="p in drawn"
          :key="p.place"
          :class="[
            'absolute size-0 origin-top-left [transform:scale(calc(1/var(--k)))]',
            // While a place waits for a click, a click near a pin is a click on the map, not on the pin.
            placing && 'pointer-events-none',
            selected === p.place && 'z-[1]',
          ]"
          :style="{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }"
        >
          <button
            type="button"
            :data-pin="p.place"
            :aria-label="p.title"
            :aria-haspopup="'dialog'"
            :aria-expanded="selected === p.place"
            :aria-describedby="editing ? hintId : undefined"
            :class="[
              'group absolute -translate-x-1/2 cursor-pointer outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink before:absolute before:-inset-3',
              p.up ? 'translate-y-0' : '-translate-y-full',
              // Only a pin that can be dragged takes the finger; otherwise a swipe that starts on it scrolls the page.
              editing && 'cursor-move touch-none',
            ]"
            @pointerdown="pinDown($event, p)"
            @pointermove="pinMove"
            @pointerup="pinUp"
            @pointercancel="pinCancel"
            @click="pinClick(p.place)"
            @keydown="pinKey($event, p.place)"
            @focus="onPinFocus($event, p)"
          >
            <!-- Fixed colours (tokens.css): a dark outline and a light halo read on any picture, in either theme. A
                 pin that is open is also bigger, with a dark centre, so colour alone is not what says so. -->
            <svg
              viewBox="0 0 28 34"
              :width="selected === p.place ? 34 : 26"
              :height="selected === p.place ? 41 : 32"
              aria-hidden="true"
              :class="['block overflow-visible', p.up && 'scale-y-[-1]']"
            >
              <path
                d="M14 32C14 32 3.5 21 3.5 13.5a10.5 10.5 0 0 1 21 0C24.5 21 14 32 14 32z"
                fill="none"
                stroke="var(--pin-halo)"
                stroke-width="5"
                stroke-linejoin="round"
              />
              <path
                d="M14 32C14 32 3.5 21 3.5 13.5a10.5 10.5 0 0 1 21 0C24.5 21 14 32 14 32z"
                :fill="selected === p.place ? 'var(--pin-selected)' : 'var(--pin-fill)'"
                stroke="var(--pin-outline)"
                stroke-width="1.8"
                stroke-linejoin="round"
              />
              <circle
                cx="14"
                cy="13.5"
                :r="selected === p.place ? 4.2 : 3.4"
                :fill="selected === p.place ? 'var(--pin-outline)' : 'var(--pin-halo)'"
                stroke="var(--pin-outline)"
                stroke-width="1.2"
              />
            </svg>
            <!-- On the right of its pin, or on the left in the right part of the picture, so it is never cut off.
                 With names off it shows for the pin that is hovered, focused or open. -->
            <span
              :class="[
                'pointer-events-none absolute max-w-40 truncate rounded border border-line-2 bg-surface px-1.5 py-0.5 text-xs font-medium text-ink shadow-sm',
                p.left ? 'right-full mr-1' : 'left-full ml-1',
                p.up ? 'top-4' : 'top-1',
                !names &&
                  selected !== p.place &&
                  'hidden group-hover:block group-focus-visible:block',
              ]"
              >{{ p.title }}</span
            >
          </button>
        </div>
      </div>
    </div>
    <p :id="hintId" class="sr-only">
      Press the arrow keys to move this pin. Hold Shift to move it further.
    </p>
    <p class="m-0 mt-1.5 text-xs text-ink-3">
      <span class="pointer-coarse:hidden"
        >{{ modLabel }} + scroll to zoom. Drag to move around.</span
      >
      <span class="hidden pointer-coarse:inline">Pinch to zoom. Drag to move around.</span>
    </p>
    <!-- The open pin's card, beside the pin (outside the frame, which clips). -->
    <div
      v-if="openPin && anchor"
      class="absolute z-10 w-64 max-w-[calc(100%-1rem)]"
      :style="{
        left: `clamp(0px, calc(${anchor.x}px - 8rem), calc(100% - 16rem))`,
        ...(anchor.below
          ? { top: `${anchor.y + 12}px` }
          : { top: `${anchor.y - 36}px`, transform: 'translateY(-100%)' }),
      }"
    >
      <slot name="popover" :pin="openPin" />
    </div>
  </div>
</template>
