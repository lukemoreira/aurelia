<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { watch } from 'vue'
import PlanCorkboard from '@/components/plan/PlanCorkboard.vue'
import OutlineTable from '@/components/plan/OutlineTable.vue'
import PlanInspector from '@/components/plan/PlanInspector.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import { usePlan } from '@/composables/usePlan'
import { useWorkspaceStore } from '@/stores/workspace'

/** Plan: the book as an outline table or a corkboard, with the details of what is selected beside it. */
const ws = useWorkspaceStore()
const p = usePlan()

// What was selected in another book, or has since been deleted, is not selected here.
watch(
  () => [ws.bookId, ws.data] as const,
  () => {
    const id = p.plan.selected
    if (!id) return
    const here =
      p.rows.value.some((r) => r.id === id) ||
      ws.data?.records.some((r) => r.meta.id === id && r.meta.type === 'arc')
    if (!here) p.plan.selected = null
  },
)
const views = [
  { value: 'outline', label: 'Outline', icon: 'list' as const },
  { value: 'cork', label: 'Corkboard', icon: 'plan' as const },
]
const colours = [
  { value: 'arc', label: 'Colour by: Arc' },
  { value: 'status', label: 'Colour by: Status' },
]
</script>

<template>
  <div class="flex min-h-full flex-col lg:h-full lg:min-h-0">
    <div
      class="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line px-5 pb-3 pt-4"
    >
      <div class="min-w-[220px] flex-1">
        <h1 class="m-0 font-prose text-[26px] font-medium leading-[1.2]">Plan</h1>
        <p class="m-0 mt-0.5 text-[12.5px] text-ink-3">
          {{ ws.book?.title }} · {{ p.summary.value }}
        </p>
      </div>
      <SegmentedControl v-model="p.plan.view" label="Plan view" :options="views" />
      <div v-if="p.plan.view === 'cork'" class="w-44">
        <Select v-model="p.plan.colourBy" :options="colours" aria-label="Colour cards by" />
      </div>
      <Button v-if="p.edit.canEdit.value" variant="primary" @click="p.addScene()">
        <Icon name="plus" :size="14" />Scene
      </Button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div class="flex min-h-[70dvh] min-w-0 flex-1 flex-col lg:min-h-0">
        <OutlineTable v-if="p.plan.view === 'outline'" />
        <PlanCorkboard v-else />
      </div>
      <PlanInspector class="shrink-0 lg:w-80 relative lg:overflow-y-auto" />
    </div>
  </div>
</template>
