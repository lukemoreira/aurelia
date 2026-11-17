<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Select from '@/components/ui/Select.vue'
import { useHistoryCompare } from '@/composables/useHistoryCompare'
import type { SceneChange } from '@/storage/snapshot-compare'
import { snapshotRef } from '@/storage/snapshot-words'
import type { Snapshot } from '@/storage/snapshots'
import WordDiff from './WordDiff.vue'

const props = defineProps<{
  snapshot: Snapshot | undefined
  /** The other snapshots it can be read against. */
  others: Snapshot[]
  /** Look at this one scene only (the scene's History); else every scene of the book. */
  sceneId?: string
}>()
const open = defineModel<boolean>('open', { default: false })
const c = useHistoryCompare(
  () => props.snapshot,
  () => props.others,
  () => props.sceneId,
)

const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`
const STATE = computed(() => ({
  changed: 'Changed',
  'only-older': `Only in ${c.sides.value.older}`,
  'only-newer': `Only in ${c.sides.value.newer}`,
  same: 'The same',
}))
const shown = computed(() =>
  props.sceneId ? c.rows.value : c.rows.value.filter((r) => r.state !== 'same'),
)
const same = computed(() => c.sameCount.value)
const sameWords = computed(() =>
  same.value
    ? `${same.value} ${same.value === 1 ? 'scene is' : 'scenes are'} the same and ${same.value === 1 ? 'is' : 'are'} not shown.`
    : '',
)
/** The one status line: always on the page, its words change (a status node that arrives already full is not always read). */
const status = computed(() => {
  if (c.loading.value) return 'Comparing…'
  const d = c.diff.value
  if (!c.current.value || !d) return ''
  if (c.current.value.state === 'same') return 'The words are the same.'
  if (!d.added && !d.removed) return 'Only spaces or line breaks changed.'
  return d.rough
    ? `About ${words(d.added)} added and about ${words(d.removed)} removed: the changes are large, so whole stretches are marked.`
    : `${words(d.added)} added, ${words(d.removed)} removed.`
})
const pick = (r: SceneChange) => (c.picked.value = r.id)

// The first change is brought into view: a long scene opens at its first mark, not its first line.
const box = ref<HTMLElement>()
watch(
  () => c.diff.value,
  async () => {
    await nextTick()
    box.value?.querySelector('del, ins')?.scrollIntoView?.({ block: 'center' })
  },
)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="snapshot ? `Compare ${snapshotRef(snapshot)}` : 'Compare'"
    size="lg"
  >
    <div class="flex flex-col gap-3">
      <Field label="Compare with">
        <Select v-model="c.against.value" :options="c.options.value" />
      </Field>
      <p role="status" class="m-0 min-h-4 text-xs text-ink-2">{{ status }}</p>
      <p v-if="c.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ c.error.value }}
      </p>
      <template v-if="!c.loading.value && !c.error.value">
        <template v-if="!sceneId">
          <p v-if="!shown.length" class="m-0 text-[12.5px] text-ink-2">No scenes changed.</p>
          <p v-if="sameWords" class="m-0 text-[12.5px] text-ink-2">{{ sameWords }}</p>
        </template>
        <ul
          v-if="!sceneId && shown.length"
          aria-label="Scenes that differ"
          class="m-0 flex max-h-40 list-none flex-col relative overflow-auto rounded-card border border-line p-0"
        >
          <li v-for="r in shown" :key="r.id" class="border-t border-line first:border-t-0">
            <button
              type="button"
              :aria-pressed="c.picked.value === r.id"
              :class="[
                'flex min-h-9 w-full flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-left hover:bg-raised pointer-coarse:min-h-11',
                c.picked.value === r.id ? 'bg-gold-soft font-medium' : '',
              ]"
              @click="pick(r)"
            >
              <span class="break-words">{{ r.title }}</span>
              <span class="text-xs text-ink-2">{{ STATE[r.state] }}</span>
            </button>
          </li>
        </ul>
        <section v-if="c.current.value" aria-label="Words compared" class="flex flex-col gap-2">
          <h3 class="m-0 text-sm font-semibold">{{ c.current.value.title }}</h3>
          <p class="m-0 text-xs text-ink-2">
            Crossed-out words are only in {{ c.sides.value.older }}. Underlined words are only in
            {{ c.sides.value.newer }}.
          </p>
          <div ref="box" class="rounded-card border border-line bg-canvas p-3">
            <WordDiff v-if="c.diff.value" :parts="c.diff.value.parts" />
          </div>
        </section>
        <p v-else-if="sceneId" class="m-0 text-ink-2">This scene is not in both.</p>
      </template>
    </div>
  </Dialog>
</template>
