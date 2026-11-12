<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import Icon from '@/components/ui/Icon.vue'
import { icons } from '@/components/ui/icons'
import Kbd from '@/components/ui/Kbd.vue'
import SeverityTag from '@/components/ui/SeverityTag.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { STATUS_LABELS, type IconName, type StatusKind } from '@/domain/ui-names'
import Tag from '@/components/ui/Tag.vue'
import Tree from '@/components/ui/Tree.vue'
import type { TreeNode } from '@/composables/useTree'
import GallerySection from './GallerySection.vue'

const tree: TreeNode[] = [
  {
    id: 'b1',
    label: 'The Lantern Gate',
    icon: 'book',
    meta: '84k',
    children: [
      {
        id: 'p1',
        label: 'Part one',
        icon: 'part',
        children: [
          {
            id: 'c1',
            label: 'Chapter 1',
            icon: 'chapter',
            meta: '3',
            children: [
              { id: 's1', label: 'The bells', icon: 'scene', status: 'final', meta: '1.2k' },
              { id: 's2', label: 'Lantern Gate', icon: 'scene', status: 'draft', meta: '980' },
              { id: 's3', label: 'Salt road', icon: 'scene', status: 'idea' },
            ],
          },
          { id: 'c2', label: 'Chapter 2', icon: 'chapter', meta: '0' },
        ],
      },
    ],
  },
  { id: 'b2', label: 'Tidewrack', icon: 'book', status: 'outline', meta: '12k' },
]
const selected = ref('s2')
const expanded = ref(['b1', 'p1', 'c1'])
const statuses = Object.keys(STATUS_LABELS) as StatusKind[]
const iconNames = Object.keys(icons) as IconName[]
const characters = [
  ['Elena Vasquez', 'var(--ember)'],
  ['Tomas Reyes', 'var(--tide)'],
  ['Marta', 'var(--moss)'],
  ['Ibrahim Okafor', 'var(--plum)'],
] as const
</script>

<template>
  <GallerySection title="Tree (navigator)">
    <div class="max-w-xs rounded-card bg-chrome p-1.5">
      <Tree v-model="selected" v-model:expanded="expanded" label="Workspace" :items="tree" />
    </div>
    <p class="text-xs text-ink-3">Selected: {{ selected }}</p>
  </GallerySection>
  <GallerySection title="Tags, status, severity">
    <div class="flex flex-wrap items-center gap-2">
      <Tag>Relationship</Tag><Tag>Learns</Tag><Tag>Gains item</Tag>
      <Tag v-for="s in statuses" :key="s" variant="pill"><StatusDot :status="s" show-label /></Tag>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <SeverityTag severity="error" /><SeverityTag severity="warning" /><SeverityTag
        severity="note"
      />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <StatusDot v-for="s in statuses" :key="s" :status="s" />
      <span class="text-xs text-ink-3">(dots alone carry a hidden word for screen readers)</span>
    </div>
  </GallerySection>
  <GallerySection title="Avatars and keys">
    <div class="flex flex-wrap items-center gap-3">
      <template v-for="[n, c] in characters" :key="n">
        <Avatar :name="n" :color="c" :size="20" />
        <Avatar :name="n" :color="c" />
        <Avatar :name="n" :color="c" :size="36" />
      </template>
      <Avatar name="No Colour" />
      <span class="flex items-center gap-1 text-[13px] text-ink-2">
        Press <Kbd>⌘</Kbd><Kbd>K</Kbd> to search
      </span>
    </div>
  </GallerySection>
  <GallerySection title="Icons">
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 text-xs text-ink-2">
      <li v-for="n in iconNames" :key="n" class="flex items-center gap-2">
        <Icon :name="n" :size="18" /> {{ n }}
      </li>
    </ul>
  </GallerySection>
</template>
