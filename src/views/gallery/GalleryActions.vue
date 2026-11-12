<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Dialog, { type DialogSize } from '@/components/ui/Dialog.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Menu, { type MenuItem } from '@/components/ui/Menu.vue'
import Popover from '@/components/ui/Popover.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import GallerySection from './GallerySection.vue'

const variants = ['primary', 'secondary', 'quiet', 'danger'] as const
const sizes = ['sm', 'md', 'lg'] as const
const menuItems: MenuItem[] = [
  { id: 'rename', label: 'Rename', icon: 'write', shortcut: 'F2' },
  { id: 'pin', label: 'Pin to the top', icon: 'pin' },
  { id: 'archive', label: 'Archive', disabled: true },
  { id: 'delete', label: 'Delete scene', icon: 'close', danger: true, separated: true },
]
const picked = ref('nothing yet')
const dialogOpen = ref<DialogSize | null>(null)
const isOpen = (size: DialogSize) => dialogOpen.value === size
const setOpen = (size: DialogSize, open: boolean) => (dialogOpen.value = open ? size : null)
</script>

<template>
  <GallerySection title="Buttons">
    <div v-for="v in variants" :key="v" class="flex flex-wrap items-center gap-2">
      <Button v-for="s in sizes" :key="s" :variant="v" :size="s">{{ v }} {{ s }}</Button>
      <Button :variant="v" disabled>Disabled</Button>
      <Button :variant="v" loading>Saving</Button>
    </div>
  </GallerySection>
  <GallerySection title="Icon buttons and tooltip">
    <div class="flex flex-wrap items-center gap-2">
      <IconButton icon="undo" label="Undo" size="sm" />
      <IconButton icon="redo" label="Redo" />
      <IconButton icon="settings" label="Settings" size="lg" />
      <IconButton icon="panel-left" label="Hide the navigator" disabled />
      <Tooltip text="Hover or focus me" side="right"><Button>With tooltip</Button></Tooltip>
    </div>
  </GallerySection>
  <GallerySection title="Menu, popover, dialog">
    <div class="flex flex-wrap items-center gap-2">
      <Menu :items="menuItems" @select="picked = $event">
        <template #trigger><Button>Scene actions</Button></template>
      </Menu>
      <span class="text-[13px] text-ink-2">Picked: {{ picked }}</span>
      <Popover>
        <template #trigger><Button variant="quiet">Link preview</Button></template>
        <p class="font-semibold">Elena Vasquez</p>
        <p class="mt-1 text-ink-2">A non-modal card. It also opens from the keyboard.</p>
      </Popover>
      <Button v-for="s in ['sm', 'md', 'lg'] as const" :key="s" @click="dialogOpen = s">
        Dialog {{ s === 'sm' ? '480' : s === 'md' ? '640' : '760' }}
      </Button>
    </div>
    <Dialog
      v-for="s in ['sm', 'md', 'lg'] as const"
      :key="s"
      :open="isOpen(s)"
      :size="s"
      title="Delete this scene?"
      description="The text is kept in Recovery for 30 days."
      @update:open="setOpen(s, $event)"
    >
      <p class="text-ink-2">Scene 4, “The Lantern Gate”, has 1,240 words.</p>
      <template #footer>
        <Button @click="dialogOpen = null">Cancel</Button>
        <Button variant="danger" @click="dialogOpen = null">Delete</Button>
      </template>
    </Dialog>
  </GallerySection>
</template>
