<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import Button from '@/components/ui/Button.vue'
import type { IconName } from '@/domain/ui-names'

export type BannerKind = 'info' | 'warn' | 'danger'

const STYLE: Record<BannerKind, { box: string; accent: string; icon: IconName }> = {
  info: { box: 'border-info-line bg-info-soft', accent: 'text-info', icon: 'info' },
  warn: { box: 'border-warn-line bg-warn-soft', accent: 'text-warn', icon: 'warning' },
  danger: { box: 'border-danger-line bg-danger-soft', accent: 'text-danger', icon: 'warning' },
}

defineProps<{
  kind: BannerKind
  title: string
  text: string
  tag?: string
  action?: string
  /** A quiet second button, for "Not now" and "Dismiss". */
  dismiss?: string
}>()
defineEmits<{ action: []; dismiss: [] }>()
</script>

<template>
  <!-- Calm, specific, always with a way out (States board). Danger interrupts; the rest wait
       in the polite live region that holds the banners (WorkspaceNotices). -->
  <div
    :role="kind === 'danger' ? 'alert' : undefined"
    :class="[
      'flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-card border py-3 pl-4 pr-3.5',
      STYLE[kind].box,
    ]"
  >
    <Icon :name="STYLE[kind].icon" :size="20" :class="STYLE[kind].accent" />
    <span class="flex min-w-[220px] flex-1 flex-col gap-px">
      <span class="font-semibold text-ink">{{ title }}</span>
      <span class="text-[12.5px] text-ink-2">{{ text }}</span>
    </span>
    <span
      v-if="tag"
      :class="['rounded-[5px] bg-surface px-2 py-px text-[11px] font-semibold', STYLE[kind].accent]"
      >{{ tag }}</span
    >
    <Button v-if="action" @click="$emit('action')">{{ action }}</Button>
    <Button v-if="dismiss" variant="quiet" @click="$emit('dismiss')">{{ dismiss }}</Button>
  </div>
</template>
