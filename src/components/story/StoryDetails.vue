<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import type { useStoryMap } from '@/composables/useStoryMap'
import ChoiceEditor from './ChoiceEditor.vue'

/** The scene selected on the map: where it can be reached from, its choices, and how to open it. */
const props = defineProps<{ map: ReturnType<typeof useStoryMap> }>()
const m = props.map
const way = reactive({ from: '', label: '' })
const root = ref<HTMLElement | null>(null)

// A problem's button took the author here: the place that mends it is in view and has the keyboard.
watch(
  () => m.asked.value?.n,
  async () => {
    const ask = m.asked.value
    if (!ask) return
    await nextTick()
    const key =
      ask.what === 'pick-scene' && ask.choice
        ? `choice-${ask.choice}-to`
        : ask.what === 'add-way-in'
          ? 'way-in'
          : 'new-choice'
    const el = root.value?.querySelector<HTMLElement>(`[data-focus="${key}"]`)
    el?.scrollIntoView({ block: 'center' })
    el?.focus()
  },
)

/** The choices that lead here: "Run" from “Smugglers’ Stair”. */
const ways = computed(() => {
  const g = m.graph.value
  const id = m.selected.value
  if (!g || !id) return []
  return g.edges
    .filter((e) => e.target === id && !e.broken)
    .map((e) => ({ id: e.id, label: e.label, from: g.nodes.get(e.from)?.title ?? '' }))
})
const sources = computed(() => {
  const g = m.graph.value
  return g
    ? g.order
        .filter((id) => id !== m.selected.value)
        .map((id) => ({ value: id, label: `${g.nodes.get(id)!.ref} · ${g.nodes.get(id)!.title}` }))
    : []
})
const from = computed({
  get: () => way.from || m.graph.value?.start || sources.value[0]?.value || '',
  set: (v: string) => (way.from = v),
})
async function addWay() {
  const to = m.selected.value
  if (!to || !from.value) return
  await m.addWayIn(to, from.value, way.label.trim() || m.node.value?.title || 'Go on')
  way.label = ''
}
const label = 'text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3'
</script>

<template>
  <section v-if="m.node.value" ref="root" aria-label="Selected scene" class="flex flex-col gap-3">
    <h2 :class="[label, 'm-0']">Selected scene</h2>
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="m-0 font-prose text-base font-medium">{{ m.node.value.title }}</h3>
      <button
        type="button"
        class="flex h-8 items-center rounded-[7px] px-2 text-xs font-medium text-gold-ink underline underline-offset-2 hover:bg-gold-soft pointer-coarse:h-11"
        @click="m.open(m.node.value.id)"
      >
        Open
      </button>
    </div>
    <div>
      <Button @click="m.playFrom(m.node.value.id)"
        ><Icon name="play" :size="13" />Play from here</Button
      >
    </div>
    <p v-if="ways.length" class="m-0 text-[12.5px] text-ink-2">
      {{ ways.length }} {{ ways.length === 1 ? 'way' : 'ways' }} in:
      <template v-for="(w, i) in ways" :key="w.id"
        >{{ i ? ', ' : '' }}“{{ w.label }}” from {{ w.from }}</template
      >.
    </p>
    <p v-else-if="m.node.value.id !== m.graph.value?.start" class="m-0 text-[12.5px] text-ink-2">
      No way in from the start.
    </p>

    <ChoiceEditor :id="m.node.value.id" start-too />

    <form
      v-if="m.canEdit.value && m.node.value.id !== m.graph.value?.start"
      class="flex flex-col gap-2 border-t border-line pt-3"
      aria-label="Add a way in"
      @submit.prevent="addWay"
    >
      <h3 :class="[label, 'm-0']">Add a way in</h3>
      <Field label="From scene"
        ><Select v-model="from" data-focus="way-in" :options="sources"
      /></Field>
      <Field label="Choice text"
        ><Input v-model="way.label" autocomplete="off" placeholder="What the reader picks"
      /></Field>
      <div><Button type="submit">Add way in</Button></div>
    </form>
  </section>
</template>
