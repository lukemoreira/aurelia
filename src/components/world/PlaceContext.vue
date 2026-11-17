<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Field from '@/components/ui/Field.vue'
import Select from '@/components/ui/Select.vue'
import { PLACE_TOP, usePlaces } from '@/composables/usePlaces'

/** Where a place or world sits: what it is inside (changeable), and the places directly inside it. */
const props = defineProps<{ id: string }>()
const p = usePlaces()
const inside = computed(() => p.children(props.id))
// What the tree shows: a parent that is not here (deleted, or in another book) reads as the top.
const current = computed(() => p.ancestors(props.id).at(-1)?.id ?? PLACE_TOP)
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field
      label="Inside"
      description="The bigger place this one is part of. Leave it at the top for a whole world."
    >
      <Select
        :model-value="current"
        :options="p.destinations(id)"
        :disabled="!p.canEdit.value"
        @update:model-value="(v) => p.move(id, v && v !== PLACE_TOP ? v : null)"
      />
    </Field>
    <section v-if="inside.length" aria-labelledby="inside-title" class="flex flex-col gap-1">
      <h2 id="inside-title" class="m-0 text-[13px] font-medium text-ink">Places inside</h2>
      <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
        <li v-for="c in inside" :key="c.id">
          <button
            type="button"
            class="inline-flex min-h-8 items-center rounded-full border border-line-2 bg-surface px-3 text-xs text-ink hover:bg-raised pointer-coarse:min-h-11"
            @click="p.open(c.id)"
          >
            {{ c.title }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
