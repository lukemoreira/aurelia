<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import type { DiffPart } from '@/domain/word-diff'

/**
 * Two texts as one: removed words are crossed out and added words are underlined (the Review
 * inbox's marks), and a screen reader is told "Removed" and "Added" in words, so colour is never
 * the only sign. The spaces before a changed word stay outside its mark. A change in spacing alone
 * (a line break, a paragraph split, a hard break) is marked too, as ↵ for a line break and · for a
 * space, so nothing that changes is ever invisible; the new spacing itself follows the mark.
 */
const props = defineProps<{ parts: DiffPart[] }>()

const glyphs = (space: string) => space.replace(/\r?\n/g, '↵').replace(/[^\S\n]/g, '·')

const pieces = computed(() =>
  props.parts.map((p) => {
    const lead = /^\s*/.exec(p.text)![0]
    const rest = p.text.slice(lead.length)
    if (p.kind === 'same') return { kind: p.kind, lead: p.text, rest: '', space: '' }
    if (rest) return { kind: p.kind, lead, rest, space: '' }
    return { kind: p.kind, lead: '', rest: '', space: p.text }
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
      }}<template v-if="p.space"
        ><component
          :is="p.kind === 'removed' ? 'del' : 'ins'"
          data-space
          :class="
            p.kind === 'removed'
              ? 'text-danger line-through decoration-2'
              : 'font-medium text-ok underline decoration-2 underline-offset-2'
          "
          ><span aria-hidden="true">{{ glyphs(p.space) }}</span
          ><span class="sr-only select-none"
            >[{{ p.kind === 'removed' ? 'Removed' : 'Added' }}:
            {{ /\n/.test(p.space) ? 'line break' : 'space' }}]</span
          ></component
        >{{ p.kind === 'added' ? p.space : '' }}</template
      ><del v-else-if="p.kind === 'removed'" class="text-danger line-through decoration-2"
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
