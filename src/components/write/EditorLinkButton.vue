<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { ToolbarButton } from 'reka-ui'
import { ref, watch } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Popover from '@/components/ui/Popover.vue'
import { setLink } from '@/editor/toolbar'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ editor: Editor; tick: number }>()
const open = ref(false)
const address = ref('')
const linked = () => props.tick >= 0 && props.editor.isActive('link')

// The words the link is for, noted when the box opens: moving into the box must not lose them.
let words = { from: 0, to: 0 }
// The box opens on the address already there, so editing a link is typing over it.
watch(open, (isOpen) => {
  if (!isOpen) return
  const { from, to } = props.editor.state.selection
  words = { from, to }
  address.value = String(props.editor.getAttributes('link').href ?? '')
})

function finish(typed: string) {
  props.editor.commands.setTextSelection(words)
  setLink(props.editor, typed)
  open.value = false
}
const apply = () => finish(address.value)
const remove = () => finish('')
</script>

<template>
  <Popover v-model:open="open" :return-focus-to="() => editor.commands.focus()">
    <template #trigger>
      <ToolbarButton aria-label="Link" :aria-pressed="linked()" title="Link" v-bind="$attrs">
        <Icon name="link" :size="16" />
      </ToolbarButton>
    </template>
    <form class="flex flex-col gap-2" @submit.prevent="apply">
      <Field label="Link address">
        <Input v-model="address" placeholder="https://example.com" />
      </Field>
      <div class="flex justify-end gap-2">
        <Button v-if="linked()" variant="quiet" @click="remove">Remove link</Button>
        <Button type="submit" variant="primary">{{ linked() ? 'Update' : 'Add link' }}</Button>
      </div>
    </form>
  </Popover>
</template>
