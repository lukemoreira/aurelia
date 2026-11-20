<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useFindReplace } from '@/composables/useFindReplace'
import { useShowMore } from '@/composables/useShowMore'

/** Find and replace in the scene text of the open book: every match listed, the ticked ones changed in one step. */
const f = useFindReplace()
const { visible, hasMore, more } = useShowMore(
  () => f.groups.value,
  () => [f.open.value, f.find.value, f.matchCase.value, f.wholeWords.value],
)
const fields = ref<HTMLElement | null>(null)

/** What to find is what the author is here to type: focus it with its text selected. */
function focusFind(event: Event) {
  event.preventDefault()
  const input = fields.value?.querySelector('input')
  input?.focus()
  input?.select()
}
const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`
const scenes = (n: number) => `${n} ${n === 1 ? 'scene' : 'scenes'}`
</script>

<template>
  <Dialog
    v-model:open="f.open.value"
    size="lg"
    title="Find and replace in this book"
    description="Changes the scene text only. Titles, notes, links and code stay as they are."
    @open-auto-focus="focusFind"
  >
    <div class="flex flex-col gap-4">
      <div ref="fields" class="grid gap-3 sm:grid-cols-2">
        <Field label="Find">
          <Input v-model="f.find.value" autocomplete="off" spellcheck="false" />
        </Field>
        <Field label="Replace with">
          <Input v-model="f.replace.value" autocomplete="off" spellcheck="false" />
        </Field>
      </div>
      <div class="flex flex-wrap gap-x-5">
        <Checkbox v-model="f.matchCase.value" label="Match case" />
        <Checkbox v-model="f.wholeWords.value" label="Whole words only" />
      </div>

      <section
        v-if="f.find.value.trim()"
        aria-labelledby="replace-places"
        class="flex flex-col gap-2"
      >
        <h3 id="replace-places" class="m-0 text-[13px] font-semibold text-ink">
          {{ places(f.total.value) }}
          <span class="font-normal text-ink-2">· {{ scenes(f.groups.value.length) }}</span>
        </h3>
        <p v-if="f.skipped.value" class="m-0 text-xs text-ink-3">{{ f.skipped.value }}</p>
        <div
          v-if="f.total.value"
          role="region"
          aria-label="Places that would change"
          tabindex="0"
          class="max-h-[38vh] relative overflow-auto rounded-control border border-line bg-canvas"
        >
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
                    :checked="f.ticked.value.has(p.key)"
                    @change="f.toggle(p.key)"
                  />
                  <span class="min-w-0 leading-[1.5] text-ink-2 [overflow-wrap:anywhere]">
                    <span>{{ p.before }}</span><mark class="rounded-sm bg-gold-soft text-ink">{{
                      p.old
                    }}</mark
                    ><span class="sr-only"> becomes </span
                    ><span aria-hidden="true" class="px-1 text-ink-3">→</span
                    ><ins class="font-semibold text-ink no-underline">{{ p.next }}</ins
                    ><span>{{ p.after }}</span>
                  </span>
                </label>
              </li>
            </ul>
          </div>
          <div v-if="hasMore" class="p-2 text-center">
            <Button size="sm" @click="more">Show more</Button>
          </div>
        </div>
        <p v-else class="m-0 text-ink-2">Not found in the scene text of this book.</p>
        <p v-if="f.total.value" class="m-0 text-xs text-ink-3">
          Places you untick stay as they are.
          <button
            type="button"
            class="rounded-sm text-ink-2 underline underline-offset-2 hover:text-ink"
            @click="f.tickAll(f.count.value < f.total.value)"
          >
            {{ f.count.value < f.total.value ? 'Tick all' : 'Untick all' }}
          </button>
        </p>
      </section>
      <p v-if="f.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ f.error.value }}
      </p>
    </div>

    <template #footer>
      <p class="mr-auto self-center text-xs text-ink-3">
        {{ places(f.count.value) }} in {{ scenes(f.sceneCount.value) }}. A snapshot “Before replace”
        is taken first, and you can undo.
      </p>
      <Button @click="f.cancel()">Cancel</Button>
      <Button
        variant="primary"
        :loading="f.busy.value"
        :disabled="!f.count.value"
        @click="f.apply()"
        >Replace {{ places(f.count.value) }}</Button
      >
    </template>
  </Dialog>
</template>
