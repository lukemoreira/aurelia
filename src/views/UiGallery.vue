<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useTheme, type ThemeChoice } from '@/composables/useTheme'
import GalleryActions from './gallery/GalleryActions.vue'
import GalleryData from './gallery/GalleryData.vue'
import GalleryForms from './gallery/GalleryForms.vue'

const { choice, setTheme } = useTheme()
</script>

<template>
  <main class="mx-auto flex max-w-5xl flex-col gap-4 bg-canvas p-6 text-ink">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="font-prose text-3xl font-medium">Aurelia components</h1>
      <SegmentedControl
        :model-value="choice"
        label="Theme"
        :options="[
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'system', label: 'System' },
        ]"
        @update:model-value="setTheme($event as ThemeChoice)"
      />
    </header>
    <GalleryActions />
    <GalleryForms />
    <GalleryData />
  </main>
</template>
