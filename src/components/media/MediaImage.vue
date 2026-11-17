<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useMediaImage } from '@/composables/useMedia'

/**
 * An imported image, drawn from an object URL of its file (or its thumbnail). Until it is read, a
 * quiet frame; when the file is not there (it was moved out of the folder, or never synced), the
 * frame says so, so a missing image is never mistaken for one that is still loading.
 */
const props = withDefaults(
  defineProps<{ id: string; alt: string; variant?: 'thumb' | 'full'; fit?: 'cover' | 'contain' }>(),
  { variant: 'thumb', fit: 'cover' },
)
const { url, failed } = useMediaImage(() => props.id, props.variant)
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="alt"
    decoding="async"
    :class="['size-full', fit === 'cover' ? 'object-cover' : 'object-contain']"
  />
  <div
    v-else-if="failed"
    role="img"
    :aria-label="`${alt}: file is missing`"
    class="flex size-full flex-col items-center justify-center gap-1 bg-warn-soft p-2 text-center text-xs font-medium text-warn"
  >
    <Icon name="warning" :size="18" />
    File is missing
  </div>
  <div
    v-else
    role="img"
    :aria-label="`${alt} (loading)`"
    class="flex size-full items-center justify-center bg-raised text-ink-3"
  >
    <Icon name="image" :size="22" />
  </div>
</template>
