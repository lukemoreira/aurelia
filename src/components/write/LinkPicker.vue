<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import { optionId, PICKER_ID } from '@/editor/links'
import type { PickerView } from '@/editor/link-env'
import { placeNear } from './placement'

/**
 * What a `[[` can point at: records and scenes by name, with what each is. The keys stay in the
 * text (the editor owns them); here a mouse can choose too. The editor points at this list while it
 * is open, so a screen reader hears the highlighted match; the status line says only how many
 * there are, once.
 */
const props = defineProps<{ picker: PickerView }>()

// The caret moves when the page scrolls: the list follows it.
const moved = ref(0)
const follow = () => moved.value++
onMounted(() => window.addEventListener('scroll', follow, true))
onBeforeUnmount(() => window.removeEventListener('scroll', follow, true))

const style = computed(() => {
  void moved.value
  return placeNear(props.picker.rect(), 336, 300)
})
const said = computed(() => {
  const n = props.picker.items.length
  return n ? `${n} ${n === 1 ? 'match' : 'matches'}` : `Nothing is called “${props.picker.query}”.`
})
</script>

<template>
  <Teleport to="body">
    <div
      :style="style"
      class="fixed z-30 flex w-80 max-w-[calc(100vw-16px)] flex-col rounded-card border border-line bg-surface p-1.5 font-ui text-[13px] text-ink shadow-card"
    >
      <span class="sr-only" role="status">{{ said }}</span>
      <ul
        v-if="picker.items.length"
        :id="PICKER_ID"
        role="listbox"
        aria-label="Link to"
        class="m-0 flex list-none flex-col gap-px p-0"
      >
        <!-- The editor keeps the focus: pressing here must not take it. -->
        <li
          v-for="(item, i) in picker.items"
          :id="optionId(i)"
          :key="item.id"
          role="option"
          :aria-selected="i === picker.active"
          :class="[
            'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-control px-2 py-1 pointer-coarse:min-h-11',
            i === picker.active ? 'bg-gold-soft' : 'hover:bg-raised',
          ]"
          @mousedown.prevent="picker.choose(item)"
        >
          <Avatar :name="item.title" :color="`var(--${item.tone})`" :size="24" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ item.title }}</span>
          <span class="text-xs text-ink-2">{{ item.label }}</span>
        </li>
      </ul>
      <p v-else :id="PICKER_ID" class="m-0 px-2 py-2 text-ink-2" aria-hidden="true">
        Nothing is called “{{ picker.query }}”.
      </p>
      <p class="m-0 mt-1 border-t border-line px-2 pb-0.5 pt-1.5 text-[11.5px] text-ink-3">
        {{ picker.items.length ? '↑ ↓ to move · ↵ to link · esc to close' : 'esc to close' }}
      </p>
    </div>
  </Teleport>
</template>
