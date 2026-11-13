<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { ToolbarButton, ToolbarRoot, ToolbarSeparator } from 'reka-ui'
import Icon from '@/components/ui/Icon.vue'
import Menu from '@/components/ui/Menu.vue'
import { isMac, modLabel } from '@/composables/useKeyboardShortcuts'
import {
  TEXT_STYLES,
  TOOLBAR_GROUPS,
  currentTextStyle,
  setTextStyle,
  type ToolbarItem,
} from '@/editor/toolbar'
import EditorLinkButton from './EditorLinkButton.vue'

const props = defineProps<{
  editor: Editor
  /** Changes with every edit and every move of the caret, so what is pressed stays true. */
  tick: number
  /** The phone's bar along the bottom: 44 px targets and only the essentials. */
  compact?: boolean
}>()

const button =
  'inline-flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-ink-2 outline-ink hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3 aria-pressed:bg-gold-soft aria-pressed:text-gold-ink pointer-coarse:size-11'

// Reading `tick` makes each of these follow the caret.
const pressed = (item: ToolbarItem) => (props.tick >= 0 && item.active?.(props.editor)) || false
const enabled = (item: ToolbarItem) => props.tick < 0 || (item.can?.(props.editor) ?? true)
const styleName = () => (props.tick >= 0 ? currentTextStyle(props.editor) : '')
const title = (item: ToolbarItem) =>
  item.shortcut ? `${item.label} (${item.shortcut.replace('Mod', modLabel)})` : item.label
const groups = () =>
  TOOLBAR_GROUPS.map((g) => g.filter((i) => !props.compact || i.phone)).filter((g) => g.length)
</script>

<template>
  <!-- The buttons never take the caret from the text: a press runs the command and the text keeps focus. -->
  <ToolbarRoot
    aria-label="Formatting"
    :class="
      compact
        ? 'flex h-14 items-center gap-0.5 border-t border-line bg-surface px-1.5 text-ink-2'
        : 'inline-flex flex-wrap items-center gap-0.5 rounded-[10px] border border-line bg-surface p-1 text-ink-2 shadow-sm'
    "
    @mousedown.prevent
  >
    <template v-if="!compact">
      <Menu
        :items="TEXT_STYLES.map((s) => ({ id: s.id, label: s.label }))"
        :return-focus-to="() => editor.commands.focus()"
        @select="(id) => setTextStyle(editor, id)"
      >
        <template #trigger>
          <ToolbarButton
            :aria-label="`Text style: ${styleName()}`"
            class="flex h-[30px] items-center gap-1.5 rounded-[7px] border-0 bg-transparent pl-2.5 pr-2 text-[12.5px] font-medium text-ink outline-ink hover:bg-raised pointer-coarse:h-11"
          >
            {{ styleName() }}<Icon name="chevron-down" :size="13" class="text-ink-3" />
          </ToolbarButton>
        </template>
      </Menu>
      <ToolbarSeparator class="mx-1 h-[18px] w-px bg-line" />
    </template>

    <template v-for="(group, g) in groups()" :key="g">
      <ToolbarSeparator v-if="g > 0" class="mx-1 h-[18px] w-px bg-line" />
      <ToolbarButton
        v-for="item in group"
        :key="item.id"
        :aria-label="item.label"
        :aria-pressed="item.active ? pressed(item) : undefined"
        :aria-keyshortcuts="item.shortcut?.replace('Mod', isMac ? 'Meta' : 'Control')"
        :title="title(item)"
        :disabled="!enabled(item)"
        :class="button"
        @click="item.run(editor)"
      >
        <Icon v-if="item.icon" :name="item.icon" :size="16" />
        <span v-else-if="item.glyph" aria-hidden="true" :class="item.glyph.class">{{
          item.glyph.text
        }}</span>
      </ToolbarButton>
      <!-- The link sits with the marks, before the lists. -->
      <EditorLinkButton v-if="g === 0" :editor="editor" :tick="tick" :class="button" />
    </template>
    <!-- On a phone: puts the keyboard away (Phone board). -->
    <template v-if="compact">
      <span class="flex-1" />
      <ToolbarButton
        class="h-10 shrink-0 rounded-[10px] border-0 bg-gold px-3.5 text-sm font-semibold text-on-gold outline-ink hover:brightness-95"
        @click="editor.commands.blur()"
        >Done</ToolbarButton
      >
    </template>
  </ToolbarRoot>
</template>
