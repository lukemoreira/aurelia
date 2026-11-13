<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import BackupDialog from '@/components/backup/BackupDialog.vue'
import Sheet from '@/components/ui/Sheet.vue'
import ActionToast from '@/components/outline/ActionToast.vue'
import MoveSceneDialog from '@/components/outline/MoveSceneDialog.vue'
import NameDialog from '@/components/outline/NameDialog.vue'
import TrashDialog from '@/components/outline/TrashDialog.vue'
import RenameWorkspaceDialog from '@/components/workspace/RenameWorkspaceDialog.vue'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import { useBackup } from '@/composables/useBackup'
import { useFocusMode } from '@/composables/useFocusMode'
import { MAIN_CONTENT_ID, panelAttr } from '@/composables/useFocusMain'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useSessionWatch } from '@/composables/useSessionWatch'
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
import WorkspaceNotices from './WorkspaceNotices.vue'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const shortcuts = useShortcutsStore()
const route = useRoute()

useSessionWatch()
useBackup()
useFocusMode()
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
    <template v-if="!layout.focus">
      <TopBar v-if="layout.wide" />
      <TopBarCompact v-else />
    </template>
    <!-- Focus mode on a phone: the way out is a 44 px row above the text, not a button over it. -->
    <div
      v-else-if="!layout.wide"
      class="flex shrink-0 justify-end px-2 pt-[env(safe-area-inset-top)]"
    >
      <Button variant="quiet" size="lg" @click="layout.toggleFocus"
        ><Icon name="close" :size="14" />Exit focus mode</Button
      >
    </div>

    <div class="flex min-h-0 flex-1">
      <div
        v-if="layout.wide && !layout.nav.collapsed && !layout.focus"
        v-bind="panelAttr('navigator')"
        class="shrink-0"
        :style="{ width: `${layout.nav.width}px` }"
      >
        <Navigator>
          <PanelHandle :panel="layout.nav" side="left" label="Resize the navigator" />
        </Navigator>
      </div>

      <main class="relative flex min-w-0 flex-1 flex-col bg-canvas">
        <Breadcrumb v-if="layout.wide && !layout.focus" />
        <WorkspaceNotices />
        <!-- Focusable so the keyboard can scroll the text. -->
        <div
          :id="MAIN_CONTENT_ID"
          tabindex="0"
          class="min-h-0 flex-1 scroll-pb-20 scroll-pt-20 overflow-y-auto"
        >
          <RouterView />
        </div>
        <ActionToast />
      </main>

      <div
        v-if="layout.wide && !layout.inspector.collapsed && !layout.focus && route.name === 'write'"
        v-bind="panelAttr('inspector')"
        class="shrink-0"
        :style="{ width: `${layout.inspector.width}px` }"
      >
        <Inspector>
          <PanelHandle :panel="layout.inspector" side="right" label="Resize the inspector" />
        </Inspector>
      </div>
    </div>

    <StatusBar v-if="!layout.focus" />
    <!-- The one control left in focus mode on a wide screen: always there, off to the side of the text. -->
    <Button
      v-else-if="layout.wide"
      variant="quiet"
      class="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30"
      @click="layout.toggleFocus"
      ><Icon name="close" :size="14" />Exit focus mode</Button
    >

    <Sheet v-model:open="layout.navSheet" title="Navigator" side="left"><Navigator /></Sheet>
    <Sheet v-model:open="layout.inspectorSheet" title="Scene details" side="right"
      ><Inspector
    /></Sheet>
    <CommandPalette />
    <BackupDialog />
    <RenameWorkspaceDialog />
    <NameDialog />
    <MoveSceneDialog />
    <TrashDialog />
  </div>
</template>
