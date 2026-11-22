<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import RecordPortrait from '@/components/world/RecordPortrait.vue'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * A book's logo or cover art: an image of the gallery, chosen like a record's portrait. The cover
 * is tall (book-cover shape), the logo small. An image that was deleted reads as none, and can still
 * be removed (the book keeps naming it until then). Read only, with no image, nothing is shown.
 */
const props = defineProps<{
  kind: 'logo' | 'cover'
  title: string
  image?: string
  editable: boolean
}>()
defineEmits<{ choose: [id: string]; clear: [] }>()
const ws = useWorkspaceStore()
const id = useId()
const shown = computed(
  () => !!props.image && !!ws.data?.media?.some((m) => m.meta.id === props.image),
)
const noun = computed(() => (props.kind === 'cover' ? 'cover art' : 'logo'))
const label = computed(() => (props.kind === 'cover' ? 'Cover art' : 'Logo'))
const size = computed(() => (props.kind === 'cover' ? 'h-[132px] w-[88px]' : 'size-16'))
</script>

<template>
  <div
    v-if="editable || shown"
    role="group"
    :aria-labelledby="id"
    class="flex flex-col items-start gap-1.5"
  >
    <span :id="id" class="text-[13px] font-medium text-ink">{{ label }}</span>
    <RecordPortrait
      :title="title"
      :image="image"
      :editable="editable"
      :noun="noun"
      :size="size"
      @choose="$emit('choose', $event)"
    />
    <Button v-if="image && editable" variant="quiet" size="sm" @click="$emit('clear')">
      Remove {{ noun }}
    </Button>
  </div>
</template>
