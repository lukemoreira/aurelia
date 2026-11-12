<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { buttonBase, iconSizeClass, type ButtonSize } from './buttonStyles'
import Icon from './Icon.vue'
import type { IconName } from '@/domain/ui-names'
import Tooltip from './Tooltip.vue'

defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{
    icon: IconName
    /** What the button does. Required: an icon alone tells a screen reader nothing. */
    label: string
    size?: ButtonSize
    disabled?: boolean
    /** Off where focus lands here on its own (a dialog's close button): no stray tooltip. */
    tooltip?: boolean
  }>(),
  { size: 'md', tooltip: true },
)
</script>

<template>
  <Tooltip :text="label" :disabled="!tooltip">
    <button
      type="button"
      v-bind="$attrs"
      :aria-label="label"
      :disabled="disabled"
      :class="[
        buttonBase,
        iconSizeClass[size],
        'text-ink-2 outline-ink hover:bg-raised hover:text-ink',
      ]"
    >
      <Icon :name="icon" :size="size === 'lg' ? 20 : 16" />
    </button>
  </Tooltip>
</template>
