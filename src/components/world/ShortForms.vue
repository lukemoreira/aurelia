<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useWorkspaceStore } from '@/stores/workspace'

/** The short forms of a character's name that Aurelia also finds (ADR-0010), each one can be turned off. */
const props = defineProps<{ id: string; disabled: boolean }>()
defineEmits<{ off: [text: string] }>()
const ws = useWorkspaceStore()
const forms = computed(() => {
  void ws.indexVersion // look again whenever the workspace changed
  return ws.index.shortFormsOf(props.id)
})
</script>

<template>
  <section v-if="forms.length" aria-labelledby="record-short" class="flex flex-col gap-1.5">
    <h2 id="record-short" class="m-0 text-[13px] font-medium text-ink">Also found as</h2>
    <p class="m-0 text-xs text-ink-3">
      Taken from the name. Turn one off and it is kept above as “Never tag it”.
    </p>
    <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
      <li
        v-for="f in forms"
        :key="f.text"
        class="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface pl-2.5 text-xs text-ink"
      >
        {{ f.text }}
        <span v-if="f.mode === 'ask'" class="text-ink-3">· asks first</span>
        <IconButton
          icon="close"
          size="sm"
          :label="`Stop finding ${f.text}`"
          :disabled="disabled"
          @click="$emit('off', f.text)"
        />
      </li>
    </ul>
  </section>
</template>
