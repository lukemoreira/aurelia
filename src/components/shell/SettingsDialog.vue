<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { storageBlocked } from '@/composables/usePersisted'
import { useTheme, type ThemeChoice } from '@/composables/useTheme'
import { EDITOR_CHOICES, useEditorStore, type EditorSettings } from '@/stores/editor'

const open = defineModel<boolean>('open', { default: false })
const { choice, setTheme } = useTheme()
const editor = useEditorStore()
const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' as const },
  { value: 'dark', label: 'Dark', icon: 'moon' as const },
  { value: 'system', label: 'System' },
]
const TEXT_SETTINGS: { key: keyof EditorSettings; label: string }[] = [
  { key: 'font', label: 'Font' },
  { key: 'size', label: 'Text size' },
  { key: 'leading', label: 'Line height' },
  { key: 'paragraphs', label: 'Paragraphs' },
]
const choose = (key: keyof EditorSettings, value: string | undefined) => {
  if (value) (editor.settings[key] as string) = value
}
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

    <section
      aria-labelledby="writing-settings"
      class="flex flex-col gap-3 border-t border-line pt-3"
    >
      <h3 id="writing-settings" class="m-0 text-[13px] font-semibold">Writing</h3>
      <div v-for="s in TEXT_SETTINGS" :key="s.key" class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium">{{ s.label }}</span>
        <SegmentedControl
          :label="s.label"
          :options="[...EDITOR_CHOICES[s.key]]"
          :model-value="editor.settings[s.key]"
          @update:model-value="choose(s.key, $event)"
        />
      </div>
      <p class="m-0 text-xs text-ink-3">
        Indent sets paragraphs as a book does; Space puts a gap between them instead.
      </p>
      <div>
        <Button variant="quiet" @click="editor.reset">Back to the defaults</Button>
      </div>
    </section>
  </Dialog>
</template>
