<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Dialog from '@/components/ui/Dialog.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { storageBlocked } from '@/composables/usePersisted'
import { useTheme, type ThemeChoice } from '@/composables/useTheme'

const open = defineModel<boolean>('open', { default: false })
const { choice, setTheme } = useTheme()
const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' as const },
  { value: 'dark', label: 'Dark', icon: 'moon' as const },
  { value: 'system', label: 'System' },
]
</script>

<template>
  <Dialog
    v-model:open="open"
    title="Settings"
    :description="
      storageBlocked ? 'Not kept — this browser blocks storage' : 'Kept on this device.'
    "
  >
    <div class="flex flex-col gap-1.5 pb-2">
      <span class="text-[13px] font-medium">Theme</span>
      <SegmentedControl
        label="Theme"
        :options="THEMES"
        :model-value="choice"
        @update:model-value="setTheme($event as ThemeChoice)"
      />
      <p class="m-0 text-xs text-ink-3">System follows your device’s light or dark setting.</p>
    </div>
  </Dialog>
</template>
