<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useNavigation } from '@/composables/useNavigation'
import { RECORD_INFO } from '@/domain/record-types'
import type { Target } from '@/index/workspace-index'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * What links to a scene or a record ("Linked from") and what it links to ("Links to"), from the
 * index. Links that point nowhere, or at two things, are listed and said so.
 */
const props = defineProps<{ id: string }>()
const ws = useWorkspaceStore()
const nav = useNavigation()

const from = computed(() => {
  void ws.indexVersion
  return ws.index.backlinks(props.id)
})
const to = computed(() => {
  void ws.indexVersion
  return ws.index.linksTo(props.id)
})

const iconOf = (t: Target) => (t.recordType ? RECORD_INFO[t.recordType].icon : 'scene')
const times = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '')
const how = (links: number, names: number) =>
  [times(links, 'link'), times(names, 'mention')].filter(Boolean).join(' · ')

const label = 'text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3'
const row =
  'flex min-h-9 w-full items-center gap-2 rounded-control px-1.5 text-left hover:bg-raised pointer-coarse:min-h-11'
</script>

<template>
  <div class="flex flex-col gap-5 text-[12.5px]">
    <section aria-labelledby="linked-from" class="flex flex-col gap-1.5">
      <h3 id="linked-from" :class="label">Linked from</h3>
      <ul v-if="from.length" class="m-0 flex list-none flex-col gap-px p-0">
        <li v-for="b in from" :key="b.from.id">
          <button type="button" :class="row" @click="nav.openTarget(b.from)">
            <Icon :name="iconOf(b.from)" :size="15" class="text-ink-3" />
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ b.from.title }}</span>
            <span class="text-xs text-ink-3">{{ how(b.links, b.names) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="m-0 text-ink-2">Nothing links here yet.</p>
    </section>

    <section aria-labelledby="links-to" class="flex flex-col gap-1.5">
      <h3 id="links-to" :class="label">Links to</h3>
      <ul v-if="to.length" class="m-0 flex list-none flex-col gap-px p-0">
        <li v-for="(o, i) in to" :key="o.target?.id ?? `${o.status}${i}`">
          <button v-if="o.target" type="button" :class="row" @click="nav.openTarget(o.target)">
            <Icon :name="iconOf(o.target)" :size="15" class="text-ink-3" />
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ o.target.title }}</span>
            <span class="text-xs text-ink-3">{{ how(o.links, o.names) }}</span>
          </button>
          <div v-else :class="[row, 'cursor-default hover:bg-transparent']">
            <Icon name="link" :size="15" class="text-warn" />
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ o.text }}</span>
            <span class="text-xs font-semibold text-warn">{{
              o.status === 'ambiguous' ? 'More than one' : 'Not found'
            }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="m-0 text-ink-2">Nothing here links to anything yet. Type [[ to link.</p>
    </section>
  </div>
</template>
