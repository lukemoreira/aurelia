<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Menu from '@/components/ui/Menu.vue'
import Tag from '@/components/ui/Tag.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { initialsOf } from '@/components/ui/initials'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useRecordSheet } from '@/composables/useRecordSheet'
import LinksList from '@/components/shell/LinksList.vue'
import SceneEditor from '@/components/write/SceneEditor.vue'
import AliasEditor from './AliasEditor.vue'
import RecordNames from './RecordNames.vue'

/** A record's sheet: the Profile of the character design, for every kind of record. */
const props = defineProps<{ id: string }>()
const s = useRecordSheet(() => props.id)
const edit = useOutlineEdits()
</script>

<template>
  <article v-if="s.record.value" class="flex w-full max-w-[720px] flex-col gap-6">
    <header class="flex flex-wrap items-start gap-[18px]">
      <div
        role="img"
        :aria-label="`${s.record.value.meta.title}, portrait placeholder`"
        :style="s.colour.value ? { background: `var(--${s.colour.value})` } : undefined"
        :class="[
          'flex h-[108px] w-[88px] flex-none items-center justify-center rounded-card border border-line font-prose text-[26px] font-medium',
          s.colour.value ? 'text-on-accent' : 'bg-gold-soft text-gold-ink',
        ]"
      >
        {{ initialsOf(s.record.value.meta.title) }}
      </div>
      <div class="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-[.12em] text-gold-ink">{{
          s.info.value?.label
        }}</span>
        <h1
          id="record-title"
          class="m-0 font-prose text-[34px] font-medium leading-[1.1] tracking-[-.01em]"
        >
          {{ s.record.value.meta.title }}
        </h1>
        <p v-if="s.record.value.summary" class="m-0 font-prose text-[15px] italic text-ink-2">
          {{ s.record.value.summary }}
        </p>
        <div class="mt-1 flex flex-wrap gap-1.5">
          <Tag variant="pill"><Icon name="globe" :size="13" />{{ s.scope.value }}</Tag>
        </div>
      </div>
      <div v-if="!s.readOnly.value" class="flex gap-1.5">
        <Button @click="edit.rename(id)">Rename…</Button>
        <Menu
          align="end"
          :items="[{ id: 'delete', label: 'Delete', icon: 'trash', danger: true }]"
          @select="edit.remove(id)"
        >
          <template #trigger>
            <button
              type="button"
              aria-label="More actions"
              class="flex size-8 items-center justify-center rounded-control border border-line-2 bg-surface text-ink-2 hover:bg-raised hover:text-ink pointer-coarse:size-11"
            >
              <Icon name="more" :size="16" />
            </button>
          </template>
        </Menu>
      </div>
    </header>

    <section aria-label="Profile" class="flex flex-col gap-4">
      <Field label="Summary" description="One line that says who or what this is.">
        <Textarea
          v-model="s.draft.summary"
          rows="2"
          :disabled="s.readOnly.value"
          @change="s.saveSummary()"
        />
      </Field>
      <Field v-for="f in s.info.value?.fields" :key="f.key" :label="f.label" :description="f.hint">
        <Input
          v-model="s.draft.fields[f.key]"
          :disabled="s.readOnly.value"
          autocomplete="off"
          @change="s.saveField(f.key)"
        />
      </Field>
      <AliasEditor
        v-model="s.draft.aliases"
        :disabled="s.readOnly.value"
        @save="s.saveAliases()"
        @add="s.addAlias()"
        @remove="s.removeAlias"
      />
      <RecordNames :id="id" />
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-ink">Notes</span>
        <div
          class="min-h-[9rem] rounded-control border border-field bg-surface px-3 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink"
        >
          <!-- The notes are written in the same editor as a scene: [[ links to a character, a place or a scene. -->
          <SceneEditor
            :key="id"
            :doc-id="id"
            :body="s.record.value.body ?? ''"
            title-id="record-title"
            input-id="record-notes"
            label="Notes"
            :names="false"
            variant="notes"
            :readonly="s.readOnly.value"
            :toolbar-target="null"
            @edit="s.typeNotes($event)"
            @blur="s.flush()"
          />
        </div>
        <p class="text-xs text-ink-3">
          Anything you want to remember. Type [[ to link to a character, a place or a scene.
        </p>
      </div>
      <p v-if="s.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ s.error.value }}
      </p>
    </section>

    <section aria-label="Links" class="flex flex-col gap-3 border-t border-line pt-5">
      <h2 class="m-0 text-[15px] font-semibold text-ink">Links</h2>
      <LinksList :id="id" />
    </section>
  </article>
</template>
