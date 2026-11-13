<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Kbd from '@/components/ui/Kbd.vue'
import Menu from '@/components/ui/Menu.vue'
import Popover from '@/components/ui/Popover.vue'
import StorageDetails from '@/components/workspace/StorageDetails.vue'
import { buttonBase, iconSizeClass } from '@/components/ui/buttonStyles'
import type { IconName } from '@/domain/ui-names'
import { modLabel, searchLabel } from '@/composables/useKeyboardShortcuts'
import { useNavigation } from '@/composables/useNavigation'
import { useTheme } from '@/composables/useTheme'
import type { ViewName } from '@/router'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import LogoMark from './LogoMark.vue'
import SettingsDialog from './SettingsDialog.vue'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const nav = useNavigation()
const route = useRoute()
const { resolved, setTheme } = useTheme()
const settingsOpen = ref(false)

const books = computed(
  () =>
    ws.data?.books.map((b) => ({
      id: b.id,
      label: b.title,
      icon: (b.mode === 'branching' ? 'branch' : 'book') as IconName,
    })) ?? [],
)
const views = computed(() => {
  const all: { view: ViewName; label: string; icon: IconName }[] = [
    { view: 'write', label: 'Write', icon: 'write' },
    { view: 'plan', label: 'Plan', icon: 'plan' },
    { view: 'map', label: 'Story map', icon: 'branch' },
    { view: 'continuity', label: 'Continuity', icon: 'continuity' },
    { view: 'world', label: 'World', icon: 'globe' },
  ]
  return all.filter((v) => v.view !== 'map' || ws.book?.mode === 'branching')
})
const isCurrent = (view: ViewName) => route.name === view
const dark = computed(() => resolved.value === 'dark')
const iconButton = [buttonBase, iconSizeClass.md, 'text-ink-2 hover:bg-raised hover:text-ink']
</script>

<template>
  <!-- One row at every width this bar is shown on. Below 1280 px the tab icons and the workspace
       label go (the words stay for a screen reader), then a long book title is cut short. -->
  <header
    class="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-chrome pl-4 pr-3 text-[13px] text-ink"
  >
    <RouterLink
      to="/"
      aria-label="Aurelia home"
      class="flex shrink-0 items-center gap-[9px] no-underline"
    >
      <LogoMark />
      <span class="font-prose text-lg font-medium leading-none tracking-[.01em]">Aurelia</span>
    </RouterLink>
    <span aria-hidden="true" class="h-[22px] w-px shrink-0 bg-line" />

    <Menu :items="books" @select="nav.openBook">
      <template #trigger>
        <button
          type="button"
          :aria-label="`Switch book: ${ws.book?.title}`"
          class="flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-control py-0 pl-2.5 pr-2 text-[13px] font-medium hover:bg-raised"
        >
          <Icon :name="ws.book?.mode === 'branching' ? 'branch' : 'book'" class="text-ink-3" />
          <span class="truncate">{{ ws.book?.title }}</span>
          <Icon name="chevron-down" :size="14" class="text-ink-3" />
        </button>
      </template>
    </Menu>

    <nav aria-label="Views" class="flex shrink-0 items-center gap-0.5">
      <RouterLink
        v-for="v in views"
        :key="v.view"
        :to="nav.viewHref(v.view) ?? '/'"
        :aria-current="isCurrent(v.view) ? 'page' : undefined"
        :class="[
          'flex h-[30px] items-center gap-[7px] rounded-control px-2.5 text-[13px] no-underline',
          isCurrent(v.view)
            ? 'bg-raised font-semibold text-ink'
            : 'font-medium text-ink-2 hover:bg-raised',
        ]"
      >
        <Icon :name="v.icon" :size="15" class="max-xl:hidden" />{{ v.label }}
      </RouterLink>
    </nav>

    <!-- The shortcut hint sits beside the button, not in it: the button's name says it already. -->
    <div class="relative ml-auto h-8 min-w-[160px] max-w-[280px] flex-1">
      <button
        type="button"
        :aria-label="searchLabel"
        class="flex size-full items-center gap-2 rounded-control border border-line bg-surface py-0 pl-2.5 pr-12 text-left text-[13px] text-ink-3 hover:border-line-2"
        @click="layout.paletteOpen = true"
      >
        <Icon name="search" :size="15" class="shrink-0" />
        <span class="flex-1 truncate">Search or run a command</span>
      </button>
      <Kbd aria-hidden="true" class="pointer-events-none absolute right-1.5 top-1.5"
        >{{ modLabel }}K</Kbd
      >
    </div>

    <Popover>
      <template #trigger>
        <button
          type="button"
          class="flex h-8 shrink-0 items-center gap-[7px] rounded-control px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-raised hover:text-ink"
        >
          <Icon name="folder" /><span class="max-xl:sr-only">{{
            ws.view?.name ?? 'Sample workspace'
          }}</span>
        </button>
      </template>
      <StorageDetails />
    </Popover>

    <Popover>
      <template #trigger>
        <button type="button" aria-label="Review inbox, empty" :class="iconButton">
          <Icon name="inbox" />
        </button>
      </template>
      <p class="m-0 font-semibold">Review inbox</p>
      <p class="mb-0 mt-1 text-ink-2">
        Nothing to review. Suggestions wait here until you accept or reject them.
      </p>
    </Popover>

    <IconButton
      :icon="dark ? 'sun' : 'moon'"
      :label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
      @click="setTheme(dark ? 'light' : 'dark')"
    />
    <IconButton icon="settings" label="Settings" @click="settingsOpen = true" />
    <SettingsDialog v-model:open="settingsOpen" />
  </header>
</template>
