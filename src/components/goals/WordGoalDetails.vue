<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import { useItemDetails } from '@/composables/useItemDetails'
import type { useWritingLog } from '@/composables/useWritingLog'
import { useWorkspaceStore } from '@/stores/workspace'

/** What the status bar's words chip opens: today, the days in a row, the book, and the two goals. */
const props = defineProps<{ goals: ReturnType<typeof useWritingLog> }>()
const ws = useWorkspaceStore()
const book = useItemDetails('book', () => ws.bookId ?? undefined)
const fmt = (n: number) => n.toLocaleString('en-US')

const daily = ref('')
watch(
  () => props.goals.goal.value,
  (g) => (daily.value = g ? String(g) : ''),
  { immediate: true },
)
const heading = 'text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3'
</script>

<template>
  <div class="flex flex-col gap-3">
    <section class="flex flex-col gap-1.5" aria-label="Today">
      <h3 :class="heading">Today</h3>
      <p class="m-0 tabular-nums">
        <b class="font-semibold">{{ fmt(goals.words.value) }}</b>
        <template v-if="goals.goal.value"> / {{ fmt(goals.goal.value) }}</template> words
      </p>
      <ProgressBar
        v-if="goals.goal.value"
        :value="goals.words.value"
        :max="goals.goal.value"
        label="Words today"
      />
      <p class="m-0 text-ink-2">
        <template v-if="goals.streak.value"
          >{{ goals.streak.value }} {{ goals.streak.value === 1 ? 'day' : 'days' }} in a
          row</template
        >
        <template v-else>Write today to start a streak.</template>
      </p>
    </section>
    <section v-if="ws.book" class="flex flex-col gap-1.5" aria-label="This book">
      <h3 :class="heading">This book</h3>
      <p class="m-0 tabular-nums">
        <b class="font-semibold">{{ fmt(goals.bookTotal.value) }}</b>
        <template v-if="ws.book.targets?.words"> / {{ fmt(ws.book.targets.words) }}</template>
        words in this book
      </p>
      <ProgressBar
        v-if="ws.book.targets?.words"
        :value="goals.bookTotal.value"
        :max="ws.book.targets.words"
        label="Words in this book"
      />
    </section>
    <form
      class="flex flex-col gap-3 border-t border-line pt-3"
      aria-label="Word goals"
      @submit.prevent
    >
      <Field label="Daily goal">
        <Input
          v-model="daily"
          inputmode="numeric"
          autocomplete="off"
          @change="goals.setDailyGoal(daily)"
        />
      </Field>
      <Field v-if="ws.book" label="Book goal">
        <Input
          v-model="book.draft.goal"
          inputmode="numeric"
          autocomplete="off"
          :disabled="book.readOnly.value"
          @change="book.saveGoal()"
        />
      </Field>
      <p
        v-if="goals.error.value || book.error.value"
        role="alert"
        class="m-0 text-xs font-medium text-danger"
      >
        {{ goals.error.value || book.error.value }}
      </p>
    </form>
  </div>
</template>
