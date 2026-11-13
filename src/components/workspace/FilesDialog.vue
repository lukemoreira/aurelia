<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import type { SessionView } from '@/storage/session'

defineProps<{ view: SessionView | null; busy: string; error: string; sync?: boolean }>()
defineEmits<{
  reconcile: [path: string, keep: 'original' | 'copy']
  keep: [id: string, path: string]
}>()
const open = defineModel<boolean>('open', { default: false })
const heading = 'm-0 text-xs font-semibold uppercase tracking-[.08em] text-ink-3'
const path = 'break-all font-mono text-xs text-ink'
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    title="Files to look at"
    description="Aurelia never deletes these. A copy you do not keep is stored in .aurelia/conflicts."
  >
    <div v-if="view" class="flex flex-col gap-5">
      <section
        v-if="view.duplicates.length"
        aria-labelledby="duplicates-title"
        class="flex flex-col gap-2"
      >
        <h3 id="duplicates-title" :class="heading">Two files with one ID</h3>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li
            v-for="d in view.duplicates"
            :key="d.id"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
          >
            <p class="m-0 text-ink-2">
              These files say they are the same item. Pick the one to keep; the others go to
              <span :class="path">.aurelia/conflicts</span>.
            </p>
            <ul class="m-0 flex list-none flex-col gap-2 p-0">
              <li v-for="f in d.files" :key="f.path" class="flex flex-wrap items-center gap-2">
                <p class="m-0 min-w-0 flex-1">
                  <span class="font-medium text-ink">“{{ f.title }}”</span><br />
                  <span :class="path">{{ f.path }}</span>
                </p>
                <Button
                  :disabled="busy === f.path || view.readOnly"
                  :aria-label="`Keep this one: ${f.path}`"
                  @click="$emit('keep', d.id, f.path)"
                  >Keep this one</Button
                >
              </li>
            </ul>
          </li>
        </ul>
      </section>
      <section v-if="view.copies.length" aria-labelledby="copies-title" class="flex flex-col gap-2">
        <h3 id="copies-title" :class="heading">Two versions of one file</h3>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li
            v-for="c in view.copies"
            :key="c.path"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
          >
            <p class="m-0 font-medium text-ink">
              “{{ c.title }}”<template v-if="sync"> — two versions</template>
            </p>
            <p v-if="sync" class="m-0 text-ink-2">
              One text is in the scene now; the other was set aside when two devices changed it.
              Keep the one you want. The other is stored, never deleted.
            </p>
            <!-- The file names carry IDs: they are there for whoever looks, not for the author who reads. -->
            <details class="text-ink-2">
              <summary class="cursor-pointer">Show the files</summary>
              <p class="m-0 mt-1">
                <span :class="path">{{ c.path }}</span><br />is a copy of
                <span :class="path">{{ c.original }}</span>
              </p>
            </details>
            <div class="flex flex-wrap gap-2">
              <Button
                :disabled="busy === c.path || view.readOnly"
                @click="$emit('reconcile', c.path, 'original')"
                >{{ sync ? 'Keep the text in the scene' : 'Keep the original' }}</Button
              >
              <Button
                :disabled="busy === c.path || view.readOnly"
                @click="$emit('reconcile', c.path, 'copy')"
                >{{ sync ? 'Use the set-aside text' : 'Keep this copy' }}</Button
              >
            </div>
          </li>
        </ul>
      </section>
      <section
        v-if="view.problems.length"
        aria-labelledby="problems-title"
        class="flex flex-col gap-2"
      >
        <h3 id="problems-title" :class="heading">Could not be read</h3>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <li
            v-for="p in view.problems"
            :key="p.path"
            class="rounded-control border border-line p-3"
          >
            <p :class="[path, 'm-0']">{{ p.path }}</p>
            <p class="m-0 mt-1 text-ink-2">{{ p.reason }}</p>
          </li>
        </ul>
      </section>
      <p
        v-if="!view.copies.length && !view.problems.length && !view.duplicates.length"
        class="m-0 text-ink-2"
      >
        Nothing left to look at.
      </p>
      <p v-if="error" role="alert" class="m-0 text-xs font-medium text-danger">{{ error }}</p>
    </div>
  </Dialog>
</template>
