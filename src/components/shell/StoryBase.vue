<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import { smallCapsHeading } from '@/components/ui/fieldStyles'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useStoryBase } from '@/composables/useStoryBase'
import { BASE_SECTIONS } from '@/domain/story-base'

/** The book's story base (ADR-0016): what grounds its lore. Written by hand, or set up with the assistant. */
const b = useStoryBase()
</script>

<template>
  <form class="flex flex-col gap-3" aria-label="Story base" @submit.prevent>
    <h3 :class="smallCapsHeading">Story base</h3>
    <p class="m-0 text-[12.5px] text-ink-2">
      What grounds the book: the assistant reads it first whenever it answers.
    </p>
    <Button v-if="b.canGuide.value" size="sm" @click="b.guide()"
      ><Icon name="spark" :size="14" />Set up the story base with the assistant</Button
    >
    <Field v-for="s in BASE_SECTIONS" :key="s.key" :label="s.label" :description="s.hint">
      <Input
        v-if="s.short"
        v-model="b.draft[s.key]"
        :inputmode="s.key === 'volumes' ? 'numeric' : undefined"
        :disabled="b.readOnly.value"
        @change="b.save(s.key)"
      />
      <Textarea
        v-else
        v-model="b.draft[s.key]"
        rows="4"
        :disabled="b.readOnly.value"
        @change="b.save(s.key)"
      />
    </Field>
    <section aria-labelledby="story-base-characters" class="flex flex-col gap-1">
      <h4 id="story-base-characters" class="m-0 text-[12.5px] font-semibold">Main characters</h4>
      <ul v-if="b.characters.value.length" class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="c in b.characters.value" :key="c.meta.id" class="text-[12.5px]">
          {{ c.meta.title }}<span v-if="c.meta.role" class="text-ink-2"> · {{ c.meta.role }}</span>
        </li>
      </ul>
      <p v-else class="m-0 text-[12.5px] text-ink-3">
        No characters yet. Add them in World, or with the assistant.
      </p>
    </section>
    <p v-if="b.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ b.error.value }}
    </p>
  </form>
</template>
