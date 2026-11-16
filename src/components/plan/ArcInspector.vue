<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useNavigation } from '@/composables/useNavigation'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useRecordSheet } from '@/composables/useRecordSheet'
import { arcBeats } from '@/domain/plan'
import { useWorkspaceStore } from '@/stores/workspace'

/** An arc as a thread: its colour and description, and every scene that advances it, book by book. */
const props = defineProps<{ id: string }>()
const ws = useWorkspaceStore()
const nav = useNavigation()
const edit = useOutlineEdits()
const s = useRecordSheet(() => props.id)
const books = computed(() => (ws.data ? arcBeats(ws.data, props.id) : []))
const total = computed(() => books.value.reduce((n, b) => n + b.beats.length, 0))
const COLOURS = [
  ['ember', 'Ember'],
  ['tide', 'Tide'],
  ['moss', 'Moss'],
  ['plum', 'Plum'],
] as const
const shared = computed(() => s.record.value?.meta.scope === 'universe')
const label = 'text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3'
</script>

<template>
  <section v-if="s.record.value" aria-label="Arc" class="flex flex-col gap-4 text-[12.5px]">
    <div class="flex items-center gap-2">
      <span
        aria-hidden="true"
        class="size-3 rounded-[3px]"
        :style="{ background: s.colour.value ? `var(--${s.colour.value})` : 'var(--ink-3)' }"
      />
      <h3 :class="label">Arc · {{ shared ? 'shared' : 'this book' }}</h3>
    </div>
    <h2 class="-mt-2 mb-0 font-prose text-[22px] font-medium leading-tight">
      {{ s.record.value.meta.title }}
    </h2>
    <div v-if="!s.readOnly.value" class="-mt-2 flex gap-1.5">
      <Button @click="edit.rename(id)">Rename…</Button>
      <Button @click="nav.openRecord(ws.bookId ?? '', id)">Open in World</Button>
    </div>

    <fieldset class="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" :disabled="s.readOnly.value">
      <legend :class="[label, 'mb-1.5 p-0']">Colour</legend>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="[token, name] in COLOURS"
          :key="token"
          type="button"
          :aria-label="name"
          :aria-pressed="s.colour.value === token"
          class="size-7 rounded-control border-2 border-transparent aria-pressed:border-ink pointer-coarse:size-11"
          :style="{ background: `var(--${token})` }"
          @click="s.saveColour(token)"
        />
        <button
          type="button"
          class="h-7 rounded-control border border-line-2 px-2 text-xs text-ink-2 hover:bg-raised aria-pressed:border-ink pointer-coarse:h-11"
          :aria-pressed="!s.colour.value"
          @click="s.saveColour(undefined)"
        >
          None
        </button>
      </div>
    </fieldset>
    <Field label="Description">
      <Textarea
        v-model="s.draft.summary"
        rows="3"
        :disabled="s.readOnly.value"
        @change="s.saveSummary()"
      />
    </Field>
    <Field v-for="f in s.info.value?.fields" :key="f.key" :label="f.label">
      <Input
        v-model="s.draft.fields[f.key]"
        :disabled="s.readOnly.value"
        autocomplete="off"
        @change="s.saveField(f.key)"
      />
    </Field>
    <p v-if="s.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ s.error.value }}
    </p>

    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <h3 :class="[label, 'flex justify-between']">
        <span>Scenes advanced</span>
        <span
          >{{ total }} {{ total === 1 ? 'scene' : 'scenes' }} · {{ books.length }}
          {{ books.length === 1 ? 'book' : 'books' }}</span
        >
      </h3>
      <p v-if="!total" class="m-0 text-ink-2">
        No scene advances it yet. Tick it on a scene, in the table or its details.
      </p>
      <section v-for="b in books" :key="b.book.id" :aria-label="b.book.title">
        <h4 class="m-0 pb-1 text-xs font-semibold text-ink">{{ b.book.title }}</h4>
        <ol class="m-0 flex list-none flex-col gap-0.5 p-0">
          <li v-for="beat in b.beats" :key="beat.id">
            <button
              type="button"
              class="grid w-full grid-cols-[44px_12px_minmax(0,1fr)] items-center gap-2 rounded-[7px] px-1.5 py-1 text-left hover:bg-raised"
              @click="nav.openScene(b.book.id, beat.id)"
            >
              <span class="font-mono text-[11.5px] text-ink-3">{{ beat.ref }}</span>
              <StatusDot v-if="beat.status" :status="beat.status" />
              <span v-else aria-hidden="true" />
              <span class="truncate">{{ beat.title }}</span>
            </button>
          </li>
        </ol>
      </section>
    </div>
  </section>
</template>
