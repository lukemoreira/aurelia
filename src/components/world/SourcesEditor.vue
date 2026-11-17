<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import type { Source } from '@/domain/schema/record'

/** What a research note stands on: each source has a title, and may have an author, a web address and a note. */
defineProps<{ disabled: boolean }>()
const sources = defineModel<Source[]>({ required: true })
defineEmits<{ save: []; add: []; remove: [index: number] }>()
</script>

<template>
  <section aria-labelledby="sources-title" class="flex flex-col gap-3">
    <div>
      <h2 id="sources-title" class="m-0 text-[13px] font-medium text-ink">Sources</h2>
      <p class="m-0 text-xs text-ink-3">
        Where this comes from: a book, an article, a person, a page.
      </p>
    </div>
    <p v-if="!sources.length" class="m-0 text-[13px] text-ink-2">No sources yet.</p>
    <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
      <li v-for="(x, i) in sources" :key="i">
        <fieldset
          class="m-0 flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-3"
        >
          <legend class="flex w-full items-center justify-between px-1 text-[13px] font-medium">
            <span>Source {{ i + 1 }}</span>
          </legend>
          <Field label="Title">
            <Input
              v-model="x.title"
              :disabled="disabled"
              autocomplete="off"
              @change="$emit('save')"
            />
          </Field>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="Author">
              <Input
                v-model="x.author"
                :disabled="disabled"
                autocomplete="off"
                @change="$emit('save')"
              />
            </Field>
            <Field label="Web address">
              <Input
                v-model="x.url"
                type="url"
                :disabled="disabled"
                autocomplete="off"
                @change="$emit('save')"
              />
            </Field>
          </div>
          <a
            v-if="/^https?:\/\//i.test(x.url ?? '')"
            :href="x.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex min-h-8 w-fit items-center text-[13px] font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
            >Open the page (new tab)</a
          >
          <Field label="Note" description="Page, chapter, what to look for.">
            <Input
              v-model="x.note"
              :disabled="disabled"
              autocomplete="off"
              @change="$emit('save')"
            />
          </Field>
          <div v-if="!disabled">
            <IconButton
              icon="trash"
              :label="`Remove source ${i + 1}`"
              @click="$emit('remove', i)"
            />
          </div>
        </fieldset>
      </li>
    </ul>
    <div>
      <Button :disabled="disabled" @click="$emit('add')">Add a source</Button>
    </div>
  </section>
</template>
