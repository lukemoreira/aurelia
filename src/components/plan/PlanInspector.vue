<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import ItemDetails from '@/components/shell/ItemDetails.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useNavigation } from '@/composables/useNavigation'
import { isId } from '@/domain/ids'
import { usePlanStore } from '@/stores/plan'
import ArcInspector from './ArcInspector.vue'

/** The side panel of the Plan view: whatever is selected — a scene, chapter, part or arc — and its fields. */
const plan = usePlanStore()
const nav = useNavigation()
const id = computed(() => plan.selected ?? undefined)
</script>

<template>
  <aside
    aria-label="Details"
    class="flex min-w-0 flex-col gap-3.5 border-l border-line bg-chrome p-4 text-ink"
  >
    <template v-if="id && isId(id, 'arc')"><ArcInspector :id="id" /></template>
    <template v-else-if="id && isId(id, 'scn')">
      <ItemDetails :id="id" kind="scene" heading="Scene" />
      <div>
        <Button @click="nav.openId(id)"><Icon name="write" :size="14" />Open in Write</Button>
      </div>
    </template>
    <template v-else-if="id && isId(id, 'chp')">
      <ItemDetails :id="id" kind="chapter" heading="Chapter" />
      <div>
        <Button @click="nav.openId(id)"><Icon name="write" :size="14" />Open in Write</Button>
      </div>
    </template>
    <ItemDetails v-else-if="id && isId(id, 'prt')" :id="id" kind="part" heading="Part" />
    <div v-else class="py-6 text-center text-[12.5px]">
      <p class="m-0 font-semibold text-ink">Nothing selected</p>
      <p class="mx-0 mb-0 mt-1 text-ink-2">
        Pick a scene, a chapter or an arc to see and change its details here.
      </p>
    </div>
  </aside>
</template>
