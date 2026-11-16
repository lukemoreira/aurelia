<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useRenameEverywhere } from '@/composables/useRenameEverywhere'

/** Rename everywhere (ADR-0010 §6): after a record is renamed, change its name in the text too. */
const r = useRenameEverywhere()

/** Long books have thousands of places: show the first, and more when asked. */
const STEP = 150
const limit = ref(STEP)
watch(
  () => [r.open.value, r.filter.value],
  () => (limit.value = STEP),
)
const visible = computed(() => {
  let left = limit.value
  return r.groups.value
    .map((g) => ({ where: g.where, places: g.places.slice(0, Math.max(0, left)) }))
    .map((g) => ((left -= g.places.length), g))
    .filter((g) => g.places.length)
})
const shownCount = computed(() => r.groups.value.reduce((n, g) => n + g.places.length, 0))
const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`
const filters = computed(() => [
  { value: 'all', label: `All ${r.total.value}` },
  { value: 'uncertain', label: `Uncertain ${r.uncertain.value.length}` },
])
</script>

<template>
  <Dialog
    v-model:open="r.open.value"
    size="lg"
    title="Change the name in your text too?"
    :description="`You renamed “${r.oldTitle.value}” to “${r.newTitle.value}”. Here is every place the old name is written.`"
  >
    <!-- After the change: what was left as it is, listed again, so nothing is forgotten. -->
    <div v-if="r.result.value" class="flex flex-col gap-3">
      <p class="m-0 text-ink">
        Changed {{ places(r.result.value.changed) }}. These {{ places(r.result.value.left.length) }}
        were left as they are.
      </p>
      <div
        role="region"
        aria-label="Places left as they are"
        tabindex="0"
        class="max-h-[38vh] overflow-auto rounded-control border border-line bg-canvas"
      >
        <ul class="m-0 list-none p-0">
          <li
            v-for="p in r.result.value.left"
            :key="p.key"
            class="border-b border-line px-3 py-2 last:border-b-0"
          >
            <span class="block text-[11.5px] font-semibold text-ink-2">{{ p.where }}</span>
            <span class="leading-[1.5] text-ink-2"
              >{{ p.before }}<strong class="text-ink">{{ p.old }}</strong
              >{{ p.after }}</span
            >
            <span v-if="p.uncertain" class="block text-xs font-medium text-warn">{{
              p.uncertain
            }}</span>
          </li>
        </ul>
      </div>
    </div>
    <div v-else class="flex flex-col gap-5">
      <section aria-labelledby="rename-forms" class="flex flex-col gap-2">
        <h3 id="rename-forms" class="m-0 text-[13px] font-semibold text-ink">
          Each form of the name
        </h3>
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          <!-- A form written nowhere has nothing to show. -->
          <template v-for="(f, i) in r.forms.value" :key="f.from">
            <li
              v-if="(r.plan.value?.forms[i]?.count ?? 0) > 0"
              class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_5.5rem] items-center gap-2"
            >
              <span class="truncate text-ink">{{ f.from }}</span>
              <span aria-hidden="true" class="text-ink-3">→</span>
              <Input
                :model-value="f.to"
                :aria-label="`New form for ${f.from}`"
                autocomplete="off"
                @update:model-value="r.setForm(i, $event)"
              />
              <span class="text-right text-xs text-ink-3">{{
                places(r.plan.value?.forms[i]?.count ?? 0)
              }}</span>
            </li>
          </template>
        </ul>
        <p class="m-0 text-xs text-ink-3">
          Possessives and capitals follow: “Elena’s” becomes “Helena’s”. Leave a box as it is to
          keep that form.
        </p>
      </section>

      <section aria-labelledby="rename-places" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 id="rename-places" class="m-0 text-[13px] font-semibold text-ink">
            Places · {{ r.reach.value }}
          </h3>
          <SegmentedControl v-model="r.filter.value" label="Show" :options="filters" />
        </div>
        <div
          role="region"
          aria-label="Places that would change"
          tabindex="0"
          class="max-h-[38vh] overflow-auto rounded-control border border-line bg-canvas"
        >
          <p v-if="!visible.length" class="m-0 p-3 text-ink-2">Nothing is uncertain.</p>
          <div v-for="g in visible" :key="g.where">
            <h4
              class="sticky top-0 m-0 border-b border-line bg-chrome px-3 py-1.5 text-[11.5px] font-semibold text-ink-2"
            >
              {{ g.where }}
            </h4>
            <ul class="m-0 list-none p-0">
              <li v-for="p in g.places" :key="p.key" class="border-b border-line last:border-b-0">
                <label
                  class="flex cursor-pointer items-start gap-2.5 px-3 py-2 pointer-coarse:py-3"
                >
                  <input
                    type="checkbox"
                    class="mt-1 size-4 shrink-0 accent-[var(--gold)]"
                    :checked="r.ticked.value.has(p.key)"
                    @change="r.toggle(p.key)"
                  />
                  <span class="min-w-0 leading-[1.5] text-ink-2">
                    <span>{{ p.before }}</span><del class="text-ink-3">{{ p.old }}</del
                    ><span class="sr-only"> becomes </span
                    ><span aria-hidden="true" class="px-1 text-ink-3">→</span
                    ><ins class="font-semibold text-ink no-underline">{{ p.next }}</ins
                    ><span>{{ p.after }}</span>
                    <span v-if="p.uncertain" class="mt-0.5 block text-xs font-medium text-warn">{{
                      p.uncertain
                    }}</span>
                  </span>
                </label>
              </li>
            </ul>
          </div>
          <div v-if="shownCount > limit" class="p-2 text-center">
            <Button size="sm" @click="limit += STEP">Show more</Button>
          </div>
        </div>
        <p class="m-0 text-xs text-ink-3">
          Uncertain places are not ticked. Places you leave unticked stay as they are.
          <button
            type="button"
            class="rounded-sm text-ink-2 underline underline-offset-2 hover:text-ink"
            @click="r.tickAll(r.count.value < r.total.value - r.uncertain.value.length)"
          >
            {{
              r.count.value < r.total.value - r.uncertain.value.length
                ? 'Tick all certain'
                : 'Untick all'
            }}
          </button>
        </p>
      </section>
      <p v-if="r.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ r.error.value }}
      </p>
    </div>

    <template #footer>
      <Button v-if="r.result.value" variant="primary" @click="r.cancel()">Done</Button>
      <template v-else>
        <p class="mr-auto self-center text-xs text-ink-3">
          {{ r.count.value }} of {{ r.total.value }} places will change. A copy of each changed file
          is kept first, and you can undo.
        </p>
        <Button @click="r.cancel()">Only rename the record</Button>
        <Button
          variant="primary"
          :loading="r.busy.value"
          :disabled="!r.count.value"
          @click="r.apply()"
          >Change {{ places(r.count.value) }}</Button
        >
      </template>
    </template>
  </Dialog>
</template>
