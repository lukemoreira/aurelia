<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import { RECORD_INFO } from '@/domain/record-types'
import type { RelationshipRow } from '@/domain/relationships'
import { useRelationships } from '@/composables/useRelationships'

/**
 * What this record is to others, in the author's words ("mentor", "creditor"). A relationship made
 * on either sheet is shown on both; it is kept on the record that listed it.
 */
const props = defineProps<{ id: string; name: string }>()
const r = useRelationships(() => props.id)
const other = ref('')
const type = ref('')
const editing = ref<string>()
const words = ref('')

const key = (row: RelationshipRow) => `${row.holder}:${row.index}`

async function add() {
  if (await r.add(other.value, type.value)) [other.value, type.value] = ['', '']
}
function edit(row: RelationshipRow) {
  editing.value = key(row)
  words.value = row.type
}
async function save(row: RelationshipRow) {
  if (await r.rename(row, words.value)) editing.value = undefined
}
</script>

<template>
  <section aria-labelledby="relations-title" class="flex flex-col gap-4">
    <div>
      <h2 id="relations-title" class="m-0 text-[13px] font-medium text-ink">Relationships</h2>
      <p class="m-0 text-xs text-ink-3">
        Who {{ name }} is close to, or at odds with. It shows on their sheet too.
      </p>
    </div>

    <p v-if="!r.rows.value.length" class="m-0 text-[13px] text-ink-2">No relationships yet.</p>
    <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li
        v-for="row in r.rows.value"
        :key="key(row)"
        class="flex flex-wrap items-center gap-2.5 rounded-control border border-line bg-surface px-2.5 py-2"
      >
        <Avatar :name="row.other.title" :size="24" />
        <button
          type="button"
          class="inline-flex min-h-8 min-w-0 items-center text-left font-medium text-ink underline-offset-2 hover:underline pointer-coarse:min-h-11"
          @click="r.open(row)"
        >
          {{ row.other.title }}
        </button>
        <span class="text-xs text-ink-3">{{ RECORD_INFO[row.other.type].label }}</span>
        <form
          v-if="editing === key(row)"
          class="flex min-w-[12rem] flex-1 items-center gap-2"
          @submit.prevent="save(row)"
        >
          <Input
            v-model="words"
            :aria-label="
              row.side === 'other'
                ? `What ${name} is to ${row.other.title}`
                : `What ${row.other.title} is to ${name}`
            "
            autocomplete="off"
          />
          <Button size="sm" variant="primary" type="submit">Save</Button>
          <Button size="sm" @click="editing = undefined">Cancel</Button>
        </form>
        <template v-else>
          <!-- Written on the other record, it reads from there: "Elena lists Mirela as “mentor”". -->
          <span v-if="row.side === 'other'" class="flex-1 text-ink-2"
            >lists {{ name }} as “{{ row.type }}”</span
          >
          <span v-else class="flex-1 text-ink-2">{{ row.type }}</span>
          <template v-if="r.canEdit.value">
            <Button
              variant="quiet"
              :aria-label="`Change what ${row.other.title} is`"
              @click="edit(row)"
            >
              Change
            </Button>
            <IconButton
              icon="close"
              :label="`Remove the relationship with ${row.other.title}`"
              @click="r.remove(row)"
            />
          </template>
        </template>
      </li>
    </ul>

    <form
      v-if="r.canEdit.value"
      class="flex flex-col gap-3 border-t border-line pt-4"
      @submit.prevent="add"
    >
      <h3 class="m-0 text-[13px] font-semibold text-ink">Add a relationship</h3>
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="With">
          <Select v-model="other" :options="r.choices.value" placeholder="Choose a record" />
        </Field>
        <Field label="What they are" description="For example: mentor, rival, sister, creditor.">
          <Input v-model="type" autocomplete="off" />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" :disabled="!other || !type.trim()">Add</Button>
      </div>
    </form>
    <p v-if="r.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ r.error.value }}
    </p>
  </section>
</template>
