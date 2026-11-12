<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Sheet from '@/components/ui/Sheet.vue'
import { MAIN_CONTENT_ID, panelAttr } from '@/composables/useFocusMain'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { entryKey } from '@/index/palette-entries'
import { useLayoutStore } from '@/stores/layout'
import { useShortcutsStore } from '@/stores/shortcuts'
import { useWorkspaceStore } from '@/stores/workspace'
import Breadcrumb from './Breadcrumb.vue'
import CommandPalette from './CommandPalette.vue'
import Inspector from './Inspector.vue'
import Navigator from './Navigator.vue'
import PanelHandle from './PanelHandle.vue'
import StatusBar from './StatusBar.vue'
import TopBar from './TopBar.vue'
import TopBarCompact from './TopBarCompact.vue'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const shortcuts = useShortcutsStore()
const route = useRoute()

useKeyboardShortcuts([
  { code: 'KeyK', run: () => (layout.paletteOpen = !layout.paletteOpen) },
  { code: 'Backslash', run: layout.toggleNavigator },
  { code: 'Backslash', alt: true, run: layout.toggleInspector },
])

// The route is the truth: what it names is what is selected, and what was opened is "recent".
watch(
  () => [route.params.bookId, route.params.sceneId, route.query.record] as const,
  ([book, scene, record]) => {
    ws.select(String(book), typeof scene === 'string' ? scene : undefined)
    layout.closeSheets()
    if (route.name === 'write' && ws.sceneId) shortcuts.touch(entryKey('scene', ws.sceneId))
    if (route.name === 'world' && typeof record === 'string')
      shortcuts.touch(entryKey('record', record))
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-dvh flex-col bg-canvas text-ink">
    <TopBar v-if="layout.wide" />
    <TopBarCompact v-else />

    <div class="flex min-h-0 flex-1">
      <div
        v-if="layout.wide && !layout.nav.collapsed"
        v-bind="panelAttr('navigator')"
        class="shrink-0"
        :style="{ width: `${layout.nav.width}px` }"
      >
        <Navigator>
          <PanelHandle :panel="layout.nav" side="left" label="Resize the navigator" />
        </Navigator>
      </div>

      <main class="flex min-w-0 flex-1 flex-col bg-canvas">
        <Breadcrumb v-if="layout.wide" />
        <!-- Focusable so the keyboard can scroll the text. -->
        <div :id="MAIN_CONTENT_ID" tabindex="0" class="min-h-0 flex-1 overflow-y-auto">
          <RouterView />
        </div>
      </main>

      <div
        v-if="layout.wide && !layout.inspector.collapsed"
        v-bind="panelAttr('inspector')"
        class="shrink-0"
        :style="{ width: `${layout.inspector.width}px` }"
      >
        <Inspector>
          <PanelHandle :panel="layout.inspector" side="right" label="Resize the inspector" />
        </Inspector>
      </div>
    </div>

    <StatusBar />

    <Sheet v-model:open="layout.navSheet" title="Navigator" side="left"><Navigator /></Sheet>
    <Sheet v-model:open="layout.inspectorSheet" title="Scene details" side="right"
      ><Inspector
    /></Sheet>
    <CommandPalette />
  </div>
</template>
