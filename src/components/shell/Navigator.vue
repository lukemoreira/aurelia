<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import Menu, { type MenuItem } from '@/components/ui/Menu.vue'
import Tree from '@/components/ui/Tree.vue'
import { useNavigation } from '@/composables/useNavigation'
import { useNavigatorTree } from '@/composables/useNavigatorTree'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useRecordEdits } from '@/composables/useRecordEdits'
import { NEW_RECORD_TYPES, RECORD_INFO } from '@/domain/record-types'
import type { RecordType } from '@/domain/schema/record'
import { useEditsStore } from '@/stores/edits'
import { useShortcutsStore } from '@/stores/shortcuts'
import { useWorkspaceStore } from '@/stores/workspace'
import NavigatorHeading from './NavigatorHeading.vue'

const ws = useWorkspaceStore()
const shortcuts = useShortcutsStore()
const nav = useNavigation()
const route = useRoute()
const { filter, books, standalone, library, expanded } = useNavigatorTree()
const edit = useOutlineEdits()
const records = useRecordEdits()
const edits = useEditsStore()

/** What "+" next to Books offers: books, parts, chapters, scenes, and the way back to deleted things. */
const bookItems = computed<MenuItem[]>(() => {
  if (!edit.canEdit.value) return []
  const shared = ws.universe?.kind === 'shared'
  return [
    { id: 'book', label: shared ? 'New book in this universe' : 'New book', icon: 'book' },
    ...(shared ? [{ id: 'standalone', label: 'New standalone book', icon: 'book' as const }] : []),
    { id: 'part', label: 'New part', icon: 'part' },
    { id: 'chapter', label: 'New chapter', icon: 'chapter' },
    ...(ws.context?.chapter.chapter.id
      ? [{ id: 'scene', label: 'New scene in this chapter', icon: 'scene' as const }]
      : []),
    { id: 'trash', label: 'Recently deleted…', icon: 'trash', separated: true },
  ]
})
function addToBooks(id: string) {
  if (id === 'book') edit.newBook()
  else if (id === 'standalone') edit.newBook(true)
  else if (id === 'part') void edit.newPart()
  else if (id === 'chapter') void edit.newChapter()
  else if (id === 'scene') void edit.newScene()
  else if (id === 'trash') edits.trashOpen = true
}
const recordItems = computed<MenuItem[]>(() =>
  edit.canEdit.value
    ? NEW_RECORD_TYPES.map((t) => ({
        id: t,
        label: `New ${RECORD_INFO[t].label.toLowerCase()}`,
        icon: RECORD_INFO[t].icon,
      }))
    : [],
)

const universes = computed(
  () =>
    ws.data?.universes
      .filter((u) => u.books.some(ws.hasBook)) // one still being made has no book yet
      .map((u) => ({ id: u.id, label: u.title })) ?? [],
)
const openRecordId = computed(() =>
  typeof route.query.record === 'string' ? route.query.record : undefined,
)
const bookCount = computed(() => ws.universe?.books.length ?? 0)

function openUniverse(id: string) {
  const first = ws.data?.universes.find((u) => u.id === id)?.books.find(ws.hasBook)
  if (first) void nav.openBook(first)
}

const pinnedEntries = computed(() => shortcuts.pinned.flatMap((k) => ws.entryByKey.get(k) ?? []))

const heading =
  'px-2.5 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-3'
const rowMenu = (node: { id: string }) => edit.rowMenu(node.id)
</script>

<template>
  <!-- `relative` holds the resize handle the shell may slot in. -->
  <nav
    aria-label="Workspace"
    class="relative flex h-full min-h-0 flex-col bg-chrome text-[13px] text-ink"
  >
    <div class="flex flex-col gap-2 px-2.5 pb-2 pt-2.5">
      <Menu :items="universes" @select="openUniverse">
        <template #trigger>
          <button
            type="button"
            class="flex h-10 items-center gap-2.5 rounded-[9px] px-2 text-left hover:bg-raised pointer-coarse:h-11"
          >
            <span
              aria-hidden="true"
              class="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gold-soft font-prose text-sm font-medium text-gold-ink"
              >{{ ws.universe?.title.charAt(0) }}</span
            >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-semibold">{{ ws.universe?.title }}</span>
              <span class="text-[11.5px] text-ink-3"
                >{{ ws.universe?.kind === 'shared' ? 'Universe' : 'Standalone' }} · {{ bookCount }}
                {{ bookCount === 1 ? 'book' : 'books' }}</span
              >
            </span>
            <Icon name="chevrons-up-down" :size="14" class="text-ink-3" />
          </button>
        </template>
      </Menu>
      <label
        class="flex h-[30px] items-center gap-[7px] rounded-control border border-field pointer-coarse:h-11 bg-surface px-2 text-ink-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink"
      >
        <Icon name="filter" :size="14" />
        <span class="sr-only">Filter the navigator</span>
        <input
          v-model="filter"
          type="search"
          placeholder="Filter"
          class="h-full min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink placeholder:text-ink-3"
        />
      </label>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
      <section v-if="pinnedEntries.length && !filter" aria-label="Pinned">
        <h2 :class="heading">Pinned</h2>
        <ul class="m-0 flex list-none flex-col gap-px p-0">
          <li
            v-for="e in pinnedEntries"
            :key="e.key"
            class="group flex h-8 items-center rounded-[7px] hover:bg-raised pointer-coarse:h-11"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-ink-2"
              @click="nav.openEntry(e)"
            >
              <Icon :name="e.icon" :size="15" /><span class="truncate">{{ e.title }}</span>
            </button>
            <button
              type="button"
              :aria-label="`Unpin ${e.title}`"
              class="mr-1 flex size-8 items-center justify-center rounded text-gold-ink hover:bg-line pointer-coarse:size-11"
              @click="shortcuts.togglePin(e.key)"
            >
              <Icon name="pin" :size="12" />
            </button>
          </li>
        </ul>
      </section>

      <section aria-label="Books">
        <NavigatorHeading
          label="Books"
          add-label="Add to the book"
          :items="bookItems"
          @select="addToBooks"
        />
        <p v-if="edit.canEdit.value && books.length" class="m-0 px-2.5 pb-1 text-[11px] text-ink-3">
          Drag to reorder, or use the row menu.
        </p>
        <Tree
          v-model:expanded="expanded"
          label="Books"
          :items="books"
          :model-value="ws.sceneId ?? undefined"
          :pinned="shortcuts.pinned"
          :menu="rowMenu"
          :drop-target="edit.dropTarget"
          @update:model-value="nav.openId"
          @pin="shortcuts.togglePin"
          @action="edit.onAction"
          @drop="edit.drop"
        />
      </section>
      <section v-if="library.length || recordItems.length" aria-label="Library">
        <NavigatorHeading
          :label="ws.universe?.kind === 'shared' ? 'Library · shared' : 'Library'"
          add-label="New record"
          :items="recordItems"
          @select="records.newRecord($event as RecordType)"
        />
        <Tree
          v-model:expanded="expanded"
          label="Library"
          :items="library"
          :model-value="openRecordId"
          :pinned="shortcuts.pinned"
          :menu="rowMenu"
          @update:model-value="nav.openId"
          @pin="shortcuts.togglePin"
          @action="edit.onAction"
        />
      </section>
      <section v-if="standalone.length" aria-label="Standalone books">
        <h2 :class="heading">Standalone books</h2>
        <Tree
          v-model:expanded="expanded"
          label="Standalone books"
          :items="standalone"
          :model-value="undefined"
          :menu="rowMenu"
          @update:model-value="nav.openId"
          @action="edit.onAction"
        />
      </section>
      <p
        v-if="filter && !books.length && !library.length && !standalone.length"
        role="status"
        class="px-2.5 py-3 text-ink-3"
      >
        Nothing matches “{{ filter }}”.
      </p>
    </div>

    <button
      v-if="ws.view"
      type="button"
      class="mx-2.5 mb-1 flex h-8 items-center gap-2 rounded-[7px] px-2 text-left text-xs text-ink-3 hover:bg-raised hover:text-ink pointer-coarse:h-11"
      @click="edits.trashOpen = true"
    >
      <Icon name="trash" :size="14" />Recently deleted
    </button>
    <div class="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-xs text-ink-3">
      <Icon name="folder" :size="14" />
      <!-- The status first and whole; the name is what gives way. -->
      <span class="shrink-0 font-medium text-ink-2">{{ ws.saveLabel }}</span>
      <span class="min-w-0 flex-1 truncate">· {{ ws.data?.workspace.name }}</span>
    </div>
    <slot />
  </nav>
</template>
