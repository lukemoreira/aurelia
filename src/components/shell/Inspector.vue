<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AssistantPanel from '@/components/assistant/AssistantPanel.vue'
import HistoryList from '@/components/history/HistoryList.vue'
import Button from '@/components/ui/Button.vue'
import { smallCapsHeading } from '@/components/ui/fieldStyles'
import Icon from '@/components/ui/Icon.vue'
import Tabs from '@/components/ui/Tabs.vue'
import { useAssistant } from '@/composables/useAssistant'
import type { IconName } from '@/domain/ui-names'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import ItemDetails from './ItemDetails.vue'
import LinksList from './LinksList.vue'
import NamesTab from './NamesTab.vue'
import SceneInspector from './SceneInspector.vue'

const route = useRoute()
const ws = useWorkspaceStore()
const tab = ref('scene')
const layout = useLayoutStore()
// "Edit choices" on the writing page: the choices are on the Scene tab.
watch(
  () => layout.choicesWanted,
  (wanted) => wanted && (tab.value = 'scene'),
  { immediate: true },
)
// Notes arrive with the feature they show; until then it is not offered. History is a section at
// the foot of the Scene and Book tabs. Icons with tooltips, so the strip fits the panel unscrolled.
const BASE_TABS: { value: string; label: string; icon: IconName }[] = [
  { value: 'scene', label: 'Scene', icon: 'scene' },
  { value: 'names', label: 'Names', icon: 'user' },
  { value: 'links', label: 'Links', icon: 'link' },
  { value: 'chapter', label: 'Chapter', icon: 'chapter' },
  { value: 'book', label: 'Book', icon: 'book' },
]
// The assistant's tab is there only when this server runs one (ADR-0015).
const assistant = useAssistant()
const TABS = computed(() =>
  assistant.state.value === 'absent'
    ? BASE_TABS
    : [...BASE_TABS, { value: 'assistant', label: 'Assistant', icon: 'spark' as const }],
)
watch(
  () => layout.assistantWanted,
  (wanted) => {
    if (!wanted) return
    tab.value = 'assistant'
    layout.assistantWanted = false
  },
  { immediate: true },
)
</script>

<template>
  <!-- `relative` holds the resize handle the shell may slot in; the scrolling is inside. -->
  <aside
    aria-label="Scene inspector"
    class="relative flex h-full min-h-0 flex-col bg-chrome text-ink"
  >
    <!-- The tabs stay at the top; only the open tab scrolls, so its scroll bar starts under them. -->
    <div class="relative flex min-h-0 flex-1 flex-col pt-1.5">
      <h2 class="sr-only">Inspector</h2>
      <Tabs v-if="route.name === 'write'" v-model="tab" label="Inspector" :items="TABS" fill>
        <template #scene>
          <div class="flex flex-col gap-5">
            <SceneInspector />
            <!-- Keyed by scene: a half-typed name and the last restore's words belong to one scene. -->
            <HistoryList
              v-if="ws.session && ws.sceneId"
              :key="ws.sceneId"
              :target="{ kind: 'scene', id: ws.sceneId }"
              class="border-t border-line pt-4"
            />
          </div>
        </template>
        <template #names><NamesTab /></template>
        <template #assistant><AssistantPanel /></template>
        <template #links><LinksList v-if="ws.sceneId" :id="ws.sceneId" /></template>
        <template #chapter>
          <div class="flex flex-col gap-5">
            <ItemDetails
              v-if="ws.context?.chapter.chapter.id"
              :id="ws.context.chapter.chapter.id"
              kind="chapter"
              heading="Chapter"
            />
            <p v-else class="m-0 text-[12.5px] text-ink-2">
              This scene is not in a chapter yet. Move it to one from the navigator.
            </p>
            <ItemDetails
              v-if="ws.context?.part"
              :id="ws.context.part.id"
              kind="part"
              heading="Part"
            />
          </div>
        </template>
        <template #book>
          <div class="flex flex-col gap-5">
            <ItemDetails :id="ws.bookId ?? undefined" kind="book" heading="Book" />
            <HistoryList
              v-if="ws.session && ws.bookId"
              :target="{ kind: 'book', id: ws.bookId }"
              class="border-t border-line pt-4"
            />
            <div class="flex flex-col gap-1.5 border-t border-line pt-4">
              <h3 :class="smallCapsHeading">Export and import</h3>
              <Button @click="layout.exportOpen = true"
                ><Icon name="download" :size="14" />Export this book…</Button
              >
              <Button v-if="!ws.view?.readOnly && ws.session" @click="layout.importOpen = true"
                ><Icon name="upload" :size="14" />Import a book…</Button
              >
            </div>
          </div>
        </template>
      </Tabs>
      <div v-else class="px-4 py-6 text-center text-[12.5px]">
        <p class="m-0 font-semibold text-ink">Nothing to inspect here</p>
        <p class="mx-0 mb-0 mt-1 text-ink-2">The details of the open scene show in Write.</p>
      </div>
    </div>
    <slot />
  </aside>
</template>
