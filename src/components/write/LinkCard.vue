<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Kbd from '@/components/ui/Kbd.vue'
import { altLabel, modLabel } from '@/composables/useKeyboardShortcuts'
import type { CardView } from '@/editor/link-env'
import { useWorkspaceStore } from '@/stores/workspace'
import { cardHeading, cardWhy } from './card-words'
import { placeNear } from './placement'

/**
 * The card on a link or a name: who or what it is, and, for a name Aurelia is not sure of, the
 * question and its answers. Not a dialog: it opens on hover and on the caret, never takes focus
 * by itself, and Alt+Down moves the keyboard into it (Escape gives it back to the text). A screen
 * reader is told of it by the status line the scene keeps (see SceneEditor).
 */
const props = defineProps<{ card: CardView }>()
const emit = defineEmits<{ hold: []; leave: []; close: [] }>()
const ws = useWorkspaceStore()
const root = ref<HTMLElement | null>(null)

const style = computed(() => placeNear(props.card.rect, 334, 260))

const first = computed(() => (props.card.targets.length === 1 ? props.card.targets[0] : undefined))
const linkedFrom = computed(() =>
  first.value && props.card.kind !== 'ask' ? ws.index.backlinks(first.value.id).length : 0,
)
const heading = computed(() => cardHeading(props.card))

/** "Someone or somewhere else…": pick another record, and that one is the answer. */
const other = ref(false)
const query = ref('')
const matches = computed(() => (other.value ? props.card.pick(query.value).slice(0, 6) : []))
async function askOther() {
  other.value = true
  await nextTick()
  root.value?.querySelector('input')?.focus()
}

/** Move the keyboard to the first button in the card. */
function focus(): boolean {
  const button = root.value?.querySelector<HTMLElement>('button')
  button?.focus()
  return !!button
}
defineExpose({ focus })

// A card is placed where its text was: when the page moves, it closes.
const close = () => emit('close')
onMounted(() => window.addEventListener('scroll', close, true))
onBeforeUnmount(() => window.removeEventListener('scroll', close, true))
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
  // To the text this card is about (a page can hold two editors), not to the first one found.
  props.card.returnFocus()
}
</script>

<template>
  <Teleport to="body">
    <aside
      ref="root"
      :aria-label="`Preview of ${first?.title ?? card.text}`"
      :style="style"
      class="fixed z-30 flex w-[318px] max-w-[calc(100vw-16px)] flex-col gap-2 rounded-card border border-line bg-surface p-3.5 pb-3 font-ui text-[12.5px] leading-[1.45] text-ink-2 shadow-card"
      @mouseenter="emit('hold')"
      @mouseleave="emit('leave')"
      @keydown="onKeydown"
    >
      <div class="flex items-center gap-2.5">
        <Avatar v-if="first" :name="first.title" :color="`var(--${first.tone})`" :size="36" />
        <div class="flex min-w-0 flex-col">
          <span class="text-[13.5px] font-semibold text-ink">{{ heading }}</span>
          <span v-if="first && card.kind !== 'ask'" class="text-xs text-ink-3">{{
            first.label
          }}</span>
        </div>
      </div>

      <p v-if="card.kind === 'ask'" class="m-0">{{ cardWhy(card) }}</p>
      <p v-else-if="first?.summary" class="m-0">{{ first.summary }}</p>
      <p v-else-if="card.status === 'missing'" class="m-0">
        Nothing in this workspace has that name yet.
      </p>
      <p v-if="linkedFrom" class="m-0 text-ink-3">
        Linked from {{ linkedFrom }} {{ linkedFrom === 1 ? 'place' : 'places' }}
      </p>

      <!-- A question: who it is, someone else, or that it is not a name. Only where the text can be changed. -->
      <div v-if="card.kind === 'ask' && card.writable" class="flex flex-col gap-1.5 pt-1">
        <Button
          v-for="t in card.targets"
          :key="t.id"
          size="sm"
          class="justify-start"
          @click="card.accept(t)"
          >Yes — {{ t.title }} <span class="text-ink-3">· {{ t.label }}</span></Button
        >
        <template v-if="other">
          <Input v-model="query" aria-label="Find a record or scene" autocomplete="off" />
          <Button
            v-for="m in matches"
            :key="m.id"
            size="sm"
            variant="quiet"
            class="justify-start"
            @click="card.accept(m)"
            >{{ m.title }} <span class="text-ink-3">· {{ m.label }}</span></Button
          >
        </template>
        <Button v-else size="sm" variant="quiet" class="justify-start" @click="askOther"
          >Someone or somewhere else…</Button
        >
        <Button size="sm" variant="quiet" class="justify-start" @click="card.notAName()"
          >Not a name</Button
        >
        <p class="m-0 text-xs text-ink-3">
          <Kbd>{{ altLabel }}</Kbd> <Kbd>↓</Kbd> to reach these, <Kbd>esc</Kbd> to leave
        </p>
      </div>
      <p v-else-if="card.kind === 'ask'" class="m-0 text-ink-3">
        This workspace cannot be changed here, so Aurelia only asks.
      </p>

      <!-- A link or a name that points at something: open it. -->
      <div v-else-if="card.targets.length" class="flex flex-col gap-1.5 pt-1">
        <Button
          v-for="t in card.targets"
          :key="t.id"
          size="sm"
          class="justify-start"
          @click="card.open(t)"
        >
          {{ card.targets.length > 1 ? `Open ${t.label.toLowerCase()} “${t.title}”` : 'Open' }}
          <template v-if="card.kind === 'link' && card.targets.length === 1"
            ><Kbd>{{ modLabel }}</Kbd
            ><Kbd>↵</Kbd></template
          >
        </Button>
      </div>
    </aside>
  </Teleport>
</template>
