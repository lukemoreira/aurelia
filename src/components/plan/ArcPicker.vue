<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Icon from '@/components/ui/Icon.vue'
import Popover from '@/components/ui/Popover.vue'
import type { ArcRef } from '@/domain/plan'

/** Which arcs a scene or chapter advances: its chips, and a list to tick them from. */
const props = defineProps<{
  options: ArcRef[]
  /** What the button says to a screen reader, e.g. "Arcs of Curfew Bells". */
  label: string
  disabled?: boolean
  /** Fill the width, as a form field does; else only as wide as its chips (a table cell). */
  field?: boolean
}>()
const model = defineModel<string[]>({ default: () => [] })
const chosen = computed(() => props.options.filter((o) => model.value.includes(o.id)))
/** Ticks one arc in place on the stored list: an arc this list cannot show (deleted, private to another book) stays, and the order is the author's. */
const toggle = (id: string, on: boolean) =>
  (model.value = on
    ? model.value.includes(id)
      ? model.value
      : [...model.value, id]
    : model.value.filter((x) => x !== id))
</script>

<template>
  <Popover>
    <template #trigger>
      <button
        type="button"
        :disabled="disabled"
        :class="[
          'flex min-h-8 items-center gap-1.5 rounded-control px-1.5 text-left text-[12.5px] text-ink-2 hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:min-h-11',
          field && 'w-full border border-field bg-surface px-2.5',
        ]"
      >
        <span class="sr-only">{{ label }}: </span>
        <span v-if="!chosen.length" class="text-ink-3">{{ field ? 'No arcs' : '—' }}</span>
        <span
          v-for="a in chosen"
          :key="a.id"
          class="inline-flex min-w-0 items-center gap-1.5 truncate"
        >
          <span
            aria-hidden="true"
            class="size-2 shrink-0 rounded-sm"
            :style="{ background: a.colour ?? 'var(--ink-3)' }"
          />{{ a.name }}
        </span>
        <Icon v-if="field && !disabled" name="chevron-down" :size="14" class="ml-auto text-ink-3" />
      </button>
    </template>
    <p v-if="!options.length" class="m-0 text-ink-2">
      No arcs yet. Add one in World, then tick it here.
    </p>
    <fieldset v-else class="m-0 flex min-w-0 flex-col border-0 p-0">
      <legend class="mb-1 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
        Arcs advanced
      </legend>
      <Checkbox
        v-for="a in options"
        :key="a.id"
        :label="a.name"
        :model-value="model.includes(a.id)"
        @update:model-value="(v) => toggle(a.id, v === true)"
      />
    </fieldset>
  </Popover>
</template>
