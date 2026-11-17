<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import { useNavigation } from '@/composables/useNavigation'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useSceneNames } from '@/composables/useSceneNames'
import NewNames from '@/components/world/NewNames.vue'

/** Names found in the open scene, and the ones Aurelia is asking about (ADR-0010). Nothing here writes into the text. */
const nav = useNavigation()
const edit = useOutlineEdits()
const { found, questions, writtenAs, who, review, notAName } = useSceneNames()

const label = 'text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3'
</script>

<template>
  <div class="flex flex-col gap-5 text-[12.5px]">
    <section aria-labelledby="names-found" class="flex flex-col gap-2">
      <h3 id="names-found" :class="label">Found in this scene</h3>
      <ul v-if="found.length" class="m-0 flex list-none flex-col gap-1 p-0">
        <li v-for="f in found" :key="f.target.id">
          <button
            type="button"
            class="flex min-h-9 w-full items-center gap-2.5 rounded-control px-1.5 text-left hover:bg-raised pointer-coarse:min-h-11"
            @click="nav.openTarget(f.target)"
          >
            <Avatar :name="f.target.title" :color="`var(--${f.target.tone})`" :size="24" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-medium text-ink">{{ f.target.title }}</span>
              <span v-if="writtenAs(f)" class="truncate text-xs text-ink-3">{{
                f.target.recordType && f.target.recordType !== 'character'
                  ? `${f.target.label.toLowerCase()} · ${writtenAs(f)}`
                  : writtenAs(f)
              }}</span>
            </span>
            <span class="text-ink-2" :aria-label="`${f.count} times`">{{ f.count }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="m-0 text-ink-2">
        No character or place is named here yet. Aurelia finds them by the names and other names you
        give them in World.
      </p>
    </section>

    <section v-if="questions.length" aria-labelledby="names-ask" class="flex flex-col gap-2">
      <h3 id="names-ask" :class="label">Needs your answer</h3>
      <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
        <li
          v-for="q in questions"
          :key="`${q.text}|${q.candidates.map((c) => c.id).join()}`"
          class="flex flex-col gap-1.5 rounded-control border border-warn-line bg-warn-soft p-2.5"
        >
          <span class="font-medium text-ink"
            >“{{ q.text }}” · {{ q.count }} {{ q.count === 1 ? 'place' : 'places' }}</span
          >
          <span class="text-ink-2">{{ who(q) }}</span>
          <span class="flex gap-1.5">
            <Button size="sm" @click="review(q)">Review</Button>
            <Button v-if="edit.canEdit.value" size="sm" variant="quiet" @click="notAName(q)"
              >Not a name{{ q.count > 1 ? ` (all ${q.count})` : '' }}</Button
            >
          </span>
        </li>
      </ul>
    </section>
    <p v-else-if="found.length" class="m-0 text-ink-3">Nothing needs your answer.</p>

    <NewNames heading="h3" compact class="border-t border-line pt-4" />
  </div>
</template>
