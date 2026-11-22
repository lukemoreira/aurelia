<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import MediaGallery from '@/components/media/MediaGallery.vue'
import MediaImage from '@/components/media/MediaImage.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { initialsOf } from '@/components/ui/initials'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * The picture of a record: a portrait for a character, an image for a place. With nothing chosen
 * it is the initials on the record's colour. The picture itself is the button that opens the
 * gallery (to choose or change it); taking it away is in the sheet's menu.
 */
const props = defineProps<{
  title: string
  image?: string
  colour?: string
  editable: boolean
  noun: string
  /** The size of the frame (a book's cover is tall, its logo small); a record's portrait by default. */
  size?: string
}>()
const emit = defineEmits<{ choose: [id: string] }>()
const ws = useWorkspaceStore()
const open = ref(false)
// An image that was deleted (it waits in Recently deleted) reads as none.
const media = computed(() => ws.data?.media?.find((m) => m.meta.id === props.image))
const alt = computed(() => media.value?.meta.caption || `${props.title}, ${props.noun}`)
const pick = (id: string) => {
  open.value = false
  emit('choose', id)
}

const frame = computed(
  () =>
    `${props.size ?? 'h-[108px] w-[88px]'} flex-none overflow-hidden rounded-card border border-line`,
)
</script>

<template>
  <div>
    <component
      :is="editable ? 'button' : 'div'"
      :type="editable ? 'button' : undefined"
      :aria-label="editable ? `${media ? 'Change' : 'Add'} ${noun}` : undefined"
      :title="editable ? `${media ? 'Change' : 'Add'} ${noun}` : undefined"
      :class="[frame, editable && 'cursor-pointer hover:border-line-2']"
      @click="editable && (open = true)"
    >
      <MediaImage v-if="media" :id="media.meta.id" :alt="alt" />
      <!-- The initials are drawn (before:content), not text in the button: its name is the action. -->
      <span
        v-else
        :aria-hidden="editable ? 'true' : undefined"
        :role="editable ? undefined : 'img'"
        :aria-label="editable ? undefined : `${title}, ${noun} placeholder`"
        :data-initials="initialsOf(title)"
        :style="colour ? { background: `var(--${colour})` } : undefined"
        :class="[
          'flex size-full items-center justify-center font-prose text-[26px] font-medium before:content-[attr(data-initials)]',
          colour ? 'text-on-accent' : 'bg-gold-soft text-gold-ink',
        ]"
      />
    </component>
    <Dialog
      v-model:open="open"
      :title="`Choose ${noun}`"
      description="Pick an image from the gallery, or add one first."
      size="lg"
    >
      <MediaGallery pick @pick="pick" />
    </Dialog>
  </div>
</template>
