<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import type { Alias } from '@/domain/schema/record'

/** The other names a record goes by (ADR-0010) and whether each is tagged in the text by itself. */
defineProps<{ disabled: boolean }>()
const aliases = defineModel<Alias[]>({ required: true })
defineEmits<{ save: []; add: []; remove: [index: number] }>()

const MATCH = [
  { value: 'auto', label: 'Tag it by itself' },
  { value: 'ask', label: 'Ask me first' },
  { value: 'never', label: 'Never tag it' },
]
</script>

<template>
  <fieldset class="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
    <legend class="mb-1.5 p-0 text-[13px] font-medium text-ink">Other names</legend>
    <p class="m-0 text-xs text-ink-3">
      Other names this goes by: a nickname, a title, a surname. Finding them in your text comes
      later.
    </p>
    <ul v-if="aliases.length" class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="(a, i) in aliases"
        :key="i"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto] items-center gap-2"
      >
        <Input
          v-model="a.text"
          :aria-label="`Other name ${i + 1}`"
          :disabled="disabled"
          autocomplete="off"
          @change="$emit('save')"
        />
        <Select
          :model-value="a.match ?? 'auto'"
          :options="MATCH"
          :disabled="disabled"
          :aria-label="`Tagging for other name ${i + 1}`"
          @update:model-value="
            (v) => {
              a.match = v as Alias['match']
              $emit('save')
            }
          "
        />
        <IconButton
          icon="close"
          :label="`Remove other name ${i + 1}`"
          :disabled="disabled"
          @click="$emit('remove', i)"
        />
      </li>
    </ul>
    <div>
      <Button size="sm" :disabled="disabled" @click="$emit('add')">Add a name</Button>
    </div>
  </fieldset>
</template>
