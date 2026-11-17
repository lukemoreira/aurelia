<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Select from '@/components/ui/Select.vue'
import Tree from '@/components/ui/Tree.vue'
import { PLACE_TOP, usePlaces } from '@/composables/usePlaces'

/**
 * Worlds and places as a tree, any depth. Move one by dragging it onto another, with Alt+↑ and
 * Alt+↓ (out one level, into the place above), or with "Move to…" in its menu.
 */
defineProps<{ selected?: string }>()
const emit = defineEmits<{ open: [id: string] }>()
const p = usePlaces()

const target = ref(PLACE_TOP)
const dialog = ref(false)
watch(p.moving, (id) => {
  dialog.value = !!id
  // It starts at where the place is now: changing nothing is Cancel, not a trap.
  target.value = (id && p.ancestors(id).at(-1)?.id) || PLACE_TOP
})
watch(dialog, (v) => !v && (p.moving.value = null))

async function move() {
  const id = p.moving.value
  dialog.value = false
  if (id) await p.move(id, target.value === PLACE_TOP ? null : target.value)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <Tree
      v-model:expanded="p.expanded.value"
      :model-value="selected"
      :items="p.nodes.value"
      label="Worlds and places"
      :menu="p.menu"
      :drop-target="p.dropTarget"
      @update:model-value="(id) => id && emit('open', id)"
      @action="p.onAction"
      @drop="(id, t) => p.move(id, t.id)"
    />
    <p v-if="p.canEdit.value && p.nodes.value.length" class="m-0 px-2 text-xs text-ink-3">
      Drag onto a place to put it inside, or use the row menu.
    </p>

    <Dialog
      v-model:open="dialog"
      title="Move to…"
      description="Pick the place it goes inside, or the top."
    >
      <form id="move-place" @submit.prevent="move">
        <Field label="Inside">
          <Select
            v-model="target"
            :options="p.moving.value ? p.destinations(p.moving.value) : []"
          />
        </Field>
      </form>
      <template #footer>
        <Button @click="dialog = false">Cancel</Button>
        <Button variant="primary" type="submit" form="move-place">Move</Button>
      </template>
    </Dialog>
  </div>
</template>
