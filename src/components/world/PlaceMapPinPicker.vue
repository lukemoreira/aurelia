<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Dialog from '@/components/ui/Dialog.vue'

interface Choice {
  id: string
  title: string
  kind?: string
  pinned: boolean
}
/** The places to put on a map: those inside this place first, then the others of the universe. */
defineProps<{ title: string; inside: Choice[]; elsewhere: Choice[] }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ pick: [id: string] }>()
const row =
  'flex min-h-9 w-full items-center justify-between gap-2 rounded-control px-2 text-left text-ink hover:bg-raised pointer-coarse:min-h-11'
</script>

<template>
  <Dialog
    v-model:open="open"
    title="Add a pin"
    description="Choose the place to put on this map. Then click the map to drop it."
  >
    <p v-if="!inside.length && !elsewhere.length" class="m-0 py-4 text-ink-2">
      There is no other place yet. Make one in the World view first.
    </p>
    <template
      v-for="group in [
        { name: `Inside ${title}`, list: inside },
        { name: 'Elsewhere in this universe', list: elsewhere },
      ]"
      :key="group.name"
    >
      <section v-if="group.list.length" class="mb-3">
        <h3 class="m-0 mb-1 text-xs font-semibold text-ink-2">{{ group.name }}</h3>
        <ul class="m-0 flex list-none flex-col p-0">
          <li v-for="c in group.list" :key="c.id">
            <button type="button" :class="row" @click="emit('pick', c.id)">
              <span>
                {{ c.title }}<span v-if="c.kind" class="text-ink-3"> · {{ c.kind }}</span>
              </span>
              <span v-if="c.pinned" class="text-xs text-ink-3"
                >On the map. Choosing it moves its pin.</span
              >
            </button>
          </li>
        </ul>
      </section>
    </template>
  </Dialog>
</template>
