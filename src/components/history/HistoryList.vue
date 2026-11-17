<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useHistory } from '@/composables/useHistory'
import { useEditsStore } from '@/stores/edits'
import type { Snapshot, SnapshotTarget } from '@/storage/snapshots'
import HistoryCompare from './HistoryCompare.vue'
import HistoryRestoreConfirm from './HistoryRestoreConfirm.vue'
import SnapshotRow from './SnapshotRow.vue'

/** The snapshots of one scene or one book: take one, compare it, restore it. */
const props = defineProps<{ target: SnapshotTarget }>()
const h = useHistory(() => props.target)
const id = useId()
const name = ref('')
const nameInput = ref<{ $el: HTMLElement }>()
const edits = useEditsStore()
const comparing = ref<Snapshot>()
const compareOpen = ref(false)
const restoring = ref<Snapshot>()
const restoreOpen = ref(false)
const what = computed(() => (props.target.kind === 'scene' ? 'scene' : 'book'))

async function submit() {
  await h.take(name.value)
  if (!h.error.value) name.value = ''
  // The button was disabled while it worked, so focus would be lost: it goes back to the name.
  await nextTick()
  nameInput.value?.$el.focus()
}
// A toast would sit over the bottom of a dialog on a phone.
const compare = (s: Snapshot) => (
  (edits.toast = null),
  (comparing.value = s),
  (compareOpen.value = true)
)
const ask = (s: Snapshot) => (
  (edits.toast = null),
  (restoring.value = s),
  (restoreOpen.value = true)
)
async function confirm() {
  if (restoring.value) await h.restore(restoring.value)
  restoreOpen.value = false
}
/** A book's snapshot in a scene's list puts back that scene only. */
const restoreLabel = (s: Snapshot) =>
  props.target.kind === 'scene' && s.kind === 'book' ? 'Restore this scene' : 'Restore'
</script>

<template>
  <section :aria-labelledby="id" class="flex flex-col gap-3">
    <h3 :id="id" class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
      History
    </h3>
    <p class="m-0 text-[12.5px] text-ink-2">
      A snapshot is a copy of this {{ what }} that you take yourself. Backup keeps versions of the
      whole workspace.
    </p>
    <form class="flex flex-col gap-2" @submit.prevent="submit">
      <Field label="Name (optional)">
        <Input
          ref="nameInput"
          v-model="name"
          maxlength="80"
          autocomplete="off"
          placeholder="Before the rewrite"
        />
      </Field>
      <div>
        <Button type="submit" :loading="h.busy.value === 'take'" :disabled="!h.canWrite.value"
          >Take snapshot</Button
        >
      </div>
    </form>
    <p v-if="!h.canWrite.value" class="m-0 text-xs text-ink-2">This workspace is read-only.</p>
    <p v-if="h.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ h.error.value }}
    </p>
    <!-- Always on the page, its words change: a status that arrives already full is not always read. -->
    <p role="status" class="m-0 text-[12.5px] text-ink-2 empty:sr-only">{{ h.outcome.value }}</p>
    <ol
      v-if="h.snapshots.value.length"
      class="m-0 list-none overflow-hidden rounded-card border border-line p-0"
      :aria-label="`Snapshots of this ${what}`"
    >
      <SnapshotRow
        v-for="s in h.snapshots.value"
        :key="s.id"
        :snapshot="s"
        :can-restore="h.canWrite.value"
        :restore-label="restoreLabel(s)"
        @compare="compare(s)"
        @restore="ask(s)"
      />
    </ol>
    <p
      v-else-if="h.loaded.value"
      class="m-0 rounded-card border border-line px-3 py-2.5 text-[12.5px] text-ink-2"
    >
      No snapshots of this {{ what }} yet.
    </p>
    <HistoryCompare
      v-model:open="compareOpen"
      :snapshot="comparing"
      :others="h.snapshots.value"
      :scene-id="target.kind === 'scene' ? target.id : undefined"
    />
    <HistoryRestoreConfirm
      v-model:open="restoreOpen"
      :snapshot="restoring"
      :kind="target.kind"
      :busy="h.busy.value === 'restore'"
      @confirm="confirm"
    />
  </section>
</template>
