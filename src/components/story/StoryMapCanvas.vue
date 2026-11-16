<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useMapCanvas } from '@/composables/useMapCanvas'
import type { useStoryMap } from '@/composables/useStoryMap'
import { NODE_H, NODE_W } from '@/domain/story-layout'

/** The scenes as boxes, the choices as arrows between them. Boxes are buttons; the arrows are only a picture. */
const props = defineProps<{ map: ReturnType<typeof useStoryMap> }>()
const m = props.map
const c = useMapCanvas(m)
const scroller = c.scroller
const setScroller = (el: unknown) => (scroller.value = el as HTMLElement | null)

const short = (s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s)
/** An arrow is drawn strong when it leaves or enters the scene selected. */
const touches = (from: string, to: string) => m.selected.value === from || m.selected.value === to
/** A scene's node by ID (the graph is looked up once, not at every place a node says something). */
const info = (id: string) => m.graph.value?.nodes.get(id)
/** What a screen reader hears after a node's name: where its choices lead. */
const describe = (id: string) => {
  const n = info(id)
  if (!n?.choices.length) return n?.ending ? 'An ending.' : 'No choices.'
  return `Choices: ${n.choices
    .map(
      (x) => `${x.label} → ${x.broken ? 'a scene that is not there' : (info(x.target)?.ref ?? '')}`,
    )
    .join('; ')}.`
}
/**
 * The border says what a scene is: gold is only the start, green an ending, and a problem is red
 * (an Error, thick) or amber (a Warning, thin; dashed when no path reaches it).
 */
const nodeClass = (id: string, ghost: boolean) => {
  const g = m.graph.value!
  const n = info(id)
  const t = m.trouble.value.get(id)
  const picked = m.selected.value === id
  if (ghost) return 'border-[1.5px] border-dashed border-danger text-danger'
  return [
    'border bg-surface text-ink',
    n?.ending && 'border-ok-line !bg-ok-soft',
    t?.severity === 'warning' && 'border-[1.5px] border-warn',
    t?.check === 'unreachable' && 'border-dashed',
    t?.severity === 'error' && 'border-2 border-danger',
    id === g.start && 'border-2 !border-gold',
    !t && !n?.ending && id !== g.start && 'border-line-2',
    picked && '!bg-raised',
    picked && !t && !n?.ending && id !== g.start && 'border-2 border-ink-2',
  ]
}
const subtitleClass = (id: string) => {
  const t = m.trouble.value.get(id)
  if (!t) return 'text-ink-3'
  return t.severity === 'error' ? 'font-semibold text-danger' : 'font-semibold text-warn'
}
</script>

<template>
  <div
    :ref="setScroller"
    role="group"
    aria-label="Story map"
    class="relative min-h-0 flex-1 cursor-grab overflow-auto bg-canvas bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:20px_20px] active:cursor-grabbing"
    @pointerdown="c.pointerdown"
    @pointermove="c.pointermove"
    @pointerup="c.pointerup"
    @pointercancel="c.pointerup"
    @wheel="c.wheel"
  >
    <div
      v-if="m.layout.value"
      :style="{
        width: `${m.layout.value.width * m.zoom.value}px`,
        height: `${m.layout.value.height * m.zoom.value}px`,
      }"
    >
      <div
        class="relative origin-top-left"
        :style="{
          width: `${m.layout.value.width}px`,
          height: `${m.layout.value.height}px`,
          transform: `scale(${m.zoom.value})`,
        }"
      >
        <svg
          aria-hidden="true"
          class="absolute inset-0 overflow-visible"
          :width="m.layout.value.width"
          :height="m.layout.value.height"
          fill="none"
        >
          <defs>
            <marker
              id="arrow"
              orient="auto"
              markerWidth="6"
              markerHeight="6"
              refX="4"
              refY="3"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0 0 L6 3 L0 6 Z" style="fill: var(--ink-3)" />
            </marker>
            <marker
              id="arrow-strong"
              orient="auto"
              markerWidth="6"
              markerHeight="6"
              refX="4"
              refY="3"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0 0 L6 3 L0 6 Z" style="fill: var(--ink)" />
            </marker>
            <marker
              id="arrow-broken"
              orient="auto"
              markerWidth="6"
              markerHeight="6"
              refX="4"
              refY="3"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0 0 L6 3 L0 6 Z" style="fill: var(--danger)" />
            </marker>
          </defs>
          <g v-for="e in m.layout.value.edges" :key="e.id">
            <path
              :d="e.d"
              stroke-linecap="round"
              :stroke-width="touches(e.from, e.to) ? 2.5 : 1.75"
              :stroke-dasharray="e.broken ? '6 6' : undefined"
              :style="{
                stroke: e.broken
                  ? 'var(--danger)'
                  : touches(e.from, e.to)
                    ? 'var(--ink)'
                    : 'var(--ink-3)',
              }"
              :marker-end="`url(#${e.broken ? 'arrow-broken' : touches(e.from, e.to) ? 'arrow-strong' : 'arrow'})`"
            />
            <text
              :x="e.lx"
              :y="e.ly"
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="12"
              style="
                paint-order: stroke;
                stroke: var(--canvas);
                stroke-width: 5px;
                stroke-linejoin: round;
              "
              :fill="e.broken ? 'var(--danger)' : 'var(--ink-2)'"
            >
              {{ short(e.label) }}
            </text>
          </g>
        </svg>

        <template v-for="n in m.layout.value.nodes" :key="n.id">
          <div
            v-if="n.ghost"
            aria-hidden="true"
            :class="[
              'absolute box-border flex flex-col justify-center rounded-[10px] px-2.5',
              nodeClass(n.id, true),
            ]"
            :style="{
              left: `${n.x}px`,
              top: `${n.y}px`,
              width: `${NODE_W}px`,
              height: `${NODE_H}px`,
            }"
          >
            <span class="text-[12.5px] font-semibold">Missing scene</span>
            <span class="font-mono text-[11px]">no longer there</span>
          </div>
          <button
            v-else
            type="button"
            :data-node="n.id"
            :tabindex="m.selected.value === n.id ? 0 : -1"
            :aria-current="m.selected.value === n.id ? 'true' : undefined"
            :aria-describedby="`desc-${n.id}`"
            :class="[
              'absolute box-border flex flex-col justify-center rounded-[10px] px-2.5 text-left focus-visible:z-10',
              nodeClass(n.id, false),
            ]"
            :style="{
              left: `${n.x}px`,
              top: `${n.y}px`,
              width: `${NODE_W}px`,
              height: `${NODE_H}px`,
            }"
            @click="m.select(n.id)"
            @dblclick="m.open(n.id)"
            @keydown="c.onKey($event, n.id)"
          >
            <span class="flex items-center gap-1.5">
              <Icon v-if="info(n.id)?.ending" name="flag" :size="14" class="shrink-0 text-ok" />
              <span class="truncate font-prose text-[14px] font-medium">{{
                info(n.id)?.title
              }}</span>
            </span>
            <span
              v-if="n.id === m.graph.value?.start"
              class="truncate text-[11px] font-semibold uppercase tracking-[.06em] text-gold-ink"
              >Start · {{ info(n.id)?.ref }}</span
            >
            <span
              v-else-if="info(n.id)?.ending && !m.trouble.value.get(n.id)"
              class="truncate text-[11px] font-semibold text-ok"
              >Ending · {{ info(n.id)?.ref }}</span
            >
            <span v-else :class="['truncate text-[11px]', subtitleClass(n.id)]"
              >{{ info(n.id)?.ref }} ·
              {{ m.trouble.value.get(n.id)?.words ?? m.subtitle(n.id) }}</span
            >
          </button>
          <span v-if="!n.ghost" :id="`desc-${n.id}`" class="sr-only">{{ describe(n.id) }}</span>
        </template>
      </div>
    </div>
  </div>
</template>
