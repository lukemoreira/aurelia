<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxRoot,
  ComboboxViewport,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import Icon from '@/components/ui/Icon.vue'
import Kbd from '@/components/ui/Kbd.vue'
import { isPinChord, pinLabel } from '@/composables/useKeyboardShortcuts'
import { usePalette, type PaletteItem } from '@/composables/usePalette'
import { useReturnFocus } from '@/composables/useReturnFocus'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { storeToRefs } from 'pinia'

const layout = useLayoutStore()
const ws = useWorkspaceStore()
const { paletteOpen } = storeToRefs(layout)
const returnFocus = useReturnFocus(paletteOpen)
const { query, groups, items, resultIds, highlighted, choose, togglePinHighlighted, isPinned } =
  usePalette()

// When the results change, Reka can keep pointing at a row that is gone, so Enter would do
// nothing. Until the highlighted row is one of the results, step to the first one.
const input = ref<{ $el: HTMLElement } | null>(null)
const highlightIsCurrent = () =>
  !!highlighted.value && resultIds.value.split('|').includes(highlighted.value)
async function highlightTop(tries = 6) {
  await nextTick()
  if (!layout.paletteOpen || highlightIsCurrent() || !resultIds.value) return
  input.value?.$el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
  )
  if (tries > 0) setTimeout(() => void highlightTop(tries - 1), 40)
}
watch([paletteOpen, resultIds], () => void highlightTop(), { flush: 'post' })

// Enter opens the highlighted result, or the first when none is: Reka loses its highlight
// when the pointer rests on a list that changes under it.
function onEnter(e: KeyboardEvent) {
  const item = items.value.find((i) => i.id === highlighted.value) ?? items.value[0]
  if (!item) return
  e.preventDefault()
  e.stopPropagation()
  choose(item)
}

// Reka sets the input's aria-controls before the list exists, so it is read back once it does.
const listboxId = ref<string>()
watch(
  [paletteOpen, resultIds],
  () =>
    (listboxId.value =
      document.querySelector('[role="listbox"][aria-label="Results"]')?.id || undefined),
  { flush: 'post' },
)

/** Alt+P pins or unpins the highlighted result. */
function onKeydown(e: KeyboardEvent) {
  if (!isPinChord(e)) return
  e.preventDefault()
  togglePinHighlighted()
}

const onHighlight = (e?: { value?: unknown }) =>
  (highlighted.value = e?.value as string | undefined)
const onSelect = (item: PaletteItem) => choose(item)
const iconStyle = (item: PaletteItem) =>
  item.color ? { background: `var(--${item.color})` } : undefined
</script>

<template>
  <DialogRoot v-model:open="paletteOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent
        aria-describedby=""
        class="fixed left-1/2 top-[10vh] z-50 flex max-h-[min(480px,80vh)] w-[calc(100vw-1.5rem)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-[13px] text-ink shadow-card"
        @close-auto-focus="returnFocus"
        @keydown="onKeydown"
      >
        <DialogTitle class="sr-only">Command palette</DialogTitle>
        <ComboboxRoot
          open
          :ignore-filter="true"
          :reset-search-term-on-select="false"
          class="flex min-h-0 flex-1 flex-col"
          @highlight="onHighlight"
          @update:model-value="() => {}"
        >
          <label class="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
            <Icon name="search" :size="18" class="text-ink-3" />
            <span class="sr-only">Search or run a command</span>
            <ComboboxInput
              ref="input"
              v-model="query"
              style="outline: none"
              auto-focus
              :aria-controls="listboxId"
              placeholder="Search or run a command…"
              class="min-w-0 flex-1 border-0 bg-transparent text-base text-ink placeholder:text-ink-3"
              @keydown.esc="layout.paletteOpen = false"
              @keydown.enter.capture="onEnter"
            />
            <span
              v-if="ws.universe"
              aria-hidden="true"
              class="rounded-md bg-raised px-2 py-0.5 text-[11.5px] font-medium text-ink-2"
              >{{ ws.universe.title }}</span
            >
          </label>
          <ComboboxContent
            position="inline"
            aria-label="Results"
            class="min-h-0 flex-1 overflow-y-auto"
          >
            <ComboboxViewport class="p-1.5 px-2">
              <ComboboxGroup v-for="g in groups" :key="g.label" :aria-label="g.label">
                <ComboboxLabel
                  class="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-3"
                  >{{ g.label }}</ComboboxLabel
                >
                <!-- An option holds no controls: pinning is Alt+P, and a pin here only shows state. -->
                <ComboboxItem
                  v-for="item in g.items"
                  :key="item.id"
                  :value="item.id"
                  class="group flex h-11 cursor-pointer items-center gap-2.5 rounded-control px-2.5 data-[highlighted]:bg-gold-soft"
                  @select="onSelect(item)"
                >
                  <span
                    aria-hidden="true"
                    :style="iconStyle(item)"
                    :class="[
                      'flex size-7 flex-none items-center justify-center rounded-[7px]',
                      item.color ? 'text-on-accent' : 'bg-raised text-ink-2',
                    ]"
                  >
                    <Icon :name="item.icon" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate font-medium text-ink">{{ item.title }}</span>
                    <span class="truncate text-xs text-ink-3 group-data-[highlighted]:text-ink-2">{{
                      item.sub
                    }}</span>
                  </span>
                  <span
                    v-if="item.hint"
                    class="text-[11.5px] text-ink-3 group-data-[highlighted]:text-ink-2"
                    >{{ item.hint }}</span
                  >
                  <template v-if="item.pinKey && isPinned(item.pinKey)">
                    <Icon name="pin" :size="13" class="flex-none text-gold-ink" />
                    <span class="sr-only">Pinned</span>
                  </template>
                </ComboboxItem>
              </ComboboxGroup>
            </ComboboxViewport>
          </ComboboxContent>
          <!-- Outside the list: a listbox holds options and nothing else. -->
          <p v-if="!groups.length" role="status" class="px-4 py-6 text-center text-ink-3">
            Nothing matches “{{ query }}”.
          </p>
        </ComboboxRoot>
        <div
          class="flex h-[38px] shrink-0 items-center gap-4 border-t border-line bg-chrome px-4 text-[11.5px] text-ink-3"
        >
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
          <span><Kbd>↵</Kbd> open</span>
          <span
            ><Kbd>{{ pinLabel }}</Kbd> pin</span
          >
          <span class="flex-1" />
          <span><Kbd>esc</Kbd> close</span>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
