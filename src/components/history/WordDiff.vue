<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import type { DiffPart } from '@/domain/word-diff'

/**
 * Two texts as one: removed words are crossed out and added words are underlined (the Review
 * inbox's marks), and a screen reader is told "Removed" and "Added" in words, so colour is never
 * the only sign. The spaces before a changed word stay outside its mark; a change in spaces alone
 * is shown as the new spacing, unmarked.
 */
const props = defineProps<{ parts: DiffPart[] }>()

const pieces = computed(() =>
  props.parts.map((p) => {
    const lead = /^\s*/.exec(p.text)![0]
    const rest = p.text.slice(lead.length)
    return rest && p.kind !== 'same'
      ? { kind: p.kind, lead, rest }
      : { kind: 'same' as const, lead: p.kind === 'removed' ? '' : p.text, rest: '' }
  }),
)
</script>

<template>
  <p
    class="m-0 whitespace-pre-wrap break-words font-serif text-[15px] leading-[1.7] text-ink"
    data-testid="word-diff"
  >
    <template v-for="(p, i) in pieces" :key="i"
      >{{ p.lead
      }}<del v-if="p.kind === 'removed'" class="text-danger line-through decoration-2"
        ><span class="sr-only select-none">[Removed: </span>{{ p.rest
        }}<span class="sr-only select-none">]</span></del
      ><ins
        v-else-if="p.kind === 'added'"
        class="font-medium text-ok underline decoration-2 underline-offset-2"
        ><span class="sr-only select-none">[Added: </span>{{ p.rest
        }}<span class="sr-only select-none">]</span></ins
      ></template
    >
  </p>
</template>
