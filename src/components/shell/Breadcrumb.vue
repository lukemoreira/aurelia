<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import IconButton from '@/components/ui/IconButton.vue'
import { focusLabel, isMac } from '@/composables/useKeyboardShortcuts'
import { useNavigation } from '@/composables/useNavigation'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

const ws = useWorkspaceStore()
const layout = useLayoutStore()
const nav = useNavigation()
const route = useRoute()

interface Crumb {
  label: string
  go?: () => void
}
const crumbs = computed<Crumb[]>(() => {
  const book = ws.book
  if (!book) return []
  const bookCrumb = { label: book.title, go: () => void nav.openBook(book.id) }
  const ctx = ws.context
  if (route.name === 'world') {
    const record = ws.data?.records.find((r) => r.meta.id === route.query.record)
    const world = { label: 'World', go: () => void nav.openView('world') }
    return [
      bookCrumb,
      record ? world : { label: world.label },
      ...(record ? [{ label: record.meta.title }] : []),
    ]
  }
  if (route.name !== 'write' || !ctx)
    return [bookCrumb, ...(route.meta.title ? [{ label: String(route.meta.title) }] : [])]
  const chapter = ctx.chapter
  return [
    bookCrumb,
    ...(ctx.part ? [{ label: ctx.part.title }] : []),
    {
      label:
        chapter.number === 0
          ? chapter.chapter.title
          : `${chapter.number} · ${chapter.chapter.title}`,
      go: () => void nav.openChapter(chapter.chapter.id),
    },
    { label: ctx.scene.meta.title },
  ]
})
</script>

<template>
  <div class="flex h-11 shrink-0 items-center gap-3 border-b border-line pl-2 pr-3">
    <IconButton
      icon="panel-left"
      :label="layout.nav.collapsed ? 'Show navigator' : 'Hide navigator'"
      @click="layout.toggleNavigator"
    />
    <nav aria-label="Breadcrumb" class="min-w-0 flex-1">
      <ol
        class="m-0 flex list-none items-center gap-2 overflow-hidden whitespace-nowrap p-0 text-[12.5px] text-ink-3"
      >
        <template v-for="(c, i) in crumbs" :key="i">
          <li v-if="i > 0" aria-hidden="true" class="shrink-0">/</li>
          <!-- Each crumb gives way with an ellipsis; the middle ones go first. -->
          <li
            :class="[
              'min-w-0 truncate',
              i === crumbs.length - 1 ? 'font-medium text-ink' : '',
              i > 0 && i < crumbs.length - 1 ? 'shrink-[8]' : '',
            ]"
            :aria-current="i === crumbs.length - 1 ? 'page' : undefined"
          >
            <button
              v-if="c.go && i < crumbs.length - 1"
              type="button"
              class="max-w-full truncate rounded px-0.5 hover:text-ink hover:underline"
              @click="c.go"
            >
              {{ c.label }}
            </button>
            <template v-else>{{ c.label }}</template>
          </li>
        </template>
      </ol>
    </nav>
    <IconButton
      v-if="route.name === 'write'"
      icon="focus"
      label="Focus mode"
      :title="`Focus mode (${focusLabel})`"
      :aria-keyshortcuts="isMac ? 'Meta+Shift+F' : 'Control+Shift+F'"
      @click="layout.toggleFocus"
    />
    <IconButton
      icon="panel-right"
      :label="layout.inspector.collapsed ? 'Show inspector' : 'Hide inspector'"
      @click="layout.toggleInspector"
    />
  </div>
</template>
