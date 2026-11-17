<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import SeverityTag from '@/components/ui/SeverityTag.vue'
import { useContinuityModel } from '@/composables/useContinuityModel'
import { useNavigation } from '@/composables/useNavigation'
import { useEditsStore } from '@/stores/edits'
import { sceneContinuity } from '@/domain/continuity-views'

/** What is true of the people in this scene once it has happened, and what the checks found about it. */
const props = defineProps<{ id: string | undefined }>()
const { model, split } = useContinuityModel()
const nav = useNavigation()
const edits = useEditsStore()
const c = computed(() =>
  model.value && props.id && model.value.byId.has(props.id)
    ? sceneContinuity(model.value, split.value.active, props.id)
    : undefined,
)
const ref_ = computed(() => model.value?.byId.get(props.id ?? '')?.ref ?? '')
/** "Review in Continuity": the list, showing this scene's findings alone. */
function review() {
  edits.findingsScene = props.id ?? null
  void nav.openView('continuity')
}
const label = 'text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3'
</script>

<template>
  <div v-if="c" class="flex flex-col gap-4">
    <section
      v-if="c.people.length"
      aria-label="State at this scene"
      class="flex flex-col gap-2.5 border-t border-line pt-3.5"
    >
      <h3 :class="label">State at {{ ref_ }}</h3>
      <div v-for="p in c.people" :key="p.id" class="flex flex-col gap-1">
        <h4 class="m-0 text-[12.5px] font-semibold">
          {{ p.name }}<span v-if="p.pov" class="text-[11px] font-semibold text-gold-ink"> POV</span>
        </h4>
        <dl class="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2.5 gap-y-1">
          <template v-for="row in p.rows" :key="row.label">
            <dt class="text-ink-3">{{ row.label }}</dt>
            <dd class="m-0">
              <span v-for="(it, i) in row.items" :key="i" class="block">
                {{ it.text }}
                <span v-if="it.since" class="text-ink-3"> since {{ it.since }}</span>
                <span v-if="it.some" class="text-ink-3"> · on some paths</span>
              </span>
            </dd>
          </template>
        </dl>
      </div>
    </section>

    <div
      v-for="f in c.findings"
      :key="f.fingerprint"
      role="note"
      class="flex flex-col gap-1 rounded-control border border-line bg-raised px-3 py-2.5"
    >
      <span class="flex items-center gap-2">
        <SeverityTag :severity="f.severity" />
        <span class="text-[12.5px] font-semibold">{{ f.title }}</span>
      </span>
      <span class="text-ink">{{ f.body }}</span>
      <button
        type="button"
        class="h-8 self-start rounded-[7px] px-1 text-xs font-medium text-gold-ink underline underline-offset-2 pointer-coarse:h-11"
        @click="review()"
      >
        Review in Continuity
      </button>
    </div>
  </div>
</template>
