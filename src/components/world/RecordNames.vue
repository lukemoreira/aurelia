<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * How this record is written across the workspace: each form of its name and how often, found by
 * Aurelia (ADR-0010) rather than typed as links. Reading only; the forms are edited above, in Other names.
 */
const props = defineProps<{ id: string }>()
const ws = useWorkspaceStore()
const usage = computed(() => {
  void ws.indexVersion // look again whenever the workspace changed
  return ws.index.nameUsage(props.id)
})
const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`
</script>

<template>
  <section aria-labelledby="record-found" class="flex flex-col gap-1.5">
    <h2 id="record-found" class="m-0 text-[13px] font-medium text-ink">Found in your writing</h2>
    <ul v-if="usage.forms.length" class="m-0 flex list-none flex-wrap gap-1.5 p-0">
      <li
        v-for="f in usage.forms"
        :key="f.text"
        class="inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs text-ink"
      >
        “{{ f.text }}” <span class="text-ink-3">{{ f.count }}</span>
      </li>
    </ul>
    <p v-else class="m-0 text-xs text-ink-3">
      Not named in any scene yet. Aurelia finds its name and its other names as you write.
    </p>
    <p v-if="usage.files" class="m-0 text-xs text-ink-3">
      In {{ usage.files }} {{ usage.files === 1 ? 'scene or note' : 'scenes and notes' }}.
    </p>
    <p v-if="usage.questions" role="status" class="m-0 text-xs font-medium text-warn">
      {{ places(usage.questions) }} could be this and Aurelia is asking: see the Names tab of each
      scene.
    </p>
  </section>
</template>
