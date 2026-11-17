<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import { useMedia } from '@/composables/useMedia'
import { useWorkspaceStore } from '@/stores/workspace'
import MediaImage from './MediaImage.vue'

/**
 * The media gallery: portraits, maps and reference images of this universe, kept in the folder
 * exactly as imported. With `pick`, choosing an image hands its ID back (a portrait, a place's picture).
 */
const props = defineProps<{ pick?: boolean }>()
const emit = defineEmits<{ pick: [id: string] }>()
const ws = useWorkspaceStore()
const titleId = useId()
const m = useMedia()
const input = ref<HTMLInputElement>()
const dragging = ref(false)
const openId = ref<string>()
const open = computed(() => m.items.value.find((x) => x.meta.id === openId.value))
const caption = ref('')
const credit = ref('')

function look(id: string) {
  openId.value = id
  const doc = m.items.value.find((x) => x.meta.id === id)
  caption.value = doc?.meta.caption ?? ''
  credit.value = doc?.meta.credit ?? ''
}
async function add(files: FileList | File[] | null | undefined) {
  const made = await m.importFiles(Array.from(files ?? []))
  // Adding an image to choose one: the one just added is the choice.
  if (made[0] && props.pick) emit('pick', made[0])
  else if (made[0]) look(made[0])
}
/** The files chosen; the input is emptied after, so the same file can be chosen again. */
function onChoose(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void add(files)
}
function onDrop(e: DragEvent) {
  dragging.value = false
  if (m.canEdit.value) void add(e.dataTransfer?.files)
}
const label = (doc: { meta: { caption?: string; name?: string; file: string } }) =>
  doc.meta.caption || doc.meta.name || doc.meta.file
const size = (n?: number) =>
  n === undefined
    ? ''
    : n < 1e6
      ? `${Math.max(1, Math.round(n / 1e3))} KB`
      : `${(n / 1e6).toFixed(1)} MB`
</script>

<template>
  <section
    :aria-labelledby="titleId"
    class="flex flex-col gap-4"
    @dragover.prevent="dragging = m.canEdit.value"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 :id="titleId" class="m-0 font-prose text-[22px] font-medium">Media</h2>
        <p class="m-0 text-[13px] text-ink-2">
          Portraits, maps and reference images, kept in your folder exactly as you add them.
        </p>
      </div>
      <template v-if="m.canEdit.value">
        <Button variant="primary" :loading="!!m.busy.value" @click="input?.click()">
          <Icon name="plus" :size="14" />Add images
        </Button>
        <input
          ref="input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg"
          class="sr-only"
          aria-label="Choose images to add"
          @change="onChoose"
        />
      </template>
    </header>

    <p v-if="m.busy.value" role="status" class="m-0 text-[13px] text-ink-2">
      Adding {{ m.busy.value.done + 1 }} of {{ m.busy.value.total }}…
    </p>
    <p
      v-if="!ws.session"
      class="m-0 rounded-control border border-line bg-raised px-3 py-2 text-[13px] text-ink-2"
    >
      The sample is a read-only tour, so it has no images. Open or create a workspace to add some.
    </p>
    <p
      v-else-if="!m.items.value.length"
      :class="[
        'm-0 rounded-card border border-dashed px-4 py-10 text-center text-[13px] text-ink-2',
        dragging ? 'border-gold bg-gold-soft' : 'border-line-2',
      ]"
    >
      No images yet.
      <template v-if="m.canEdit.value">Drop some here, or use Add images.</template>
    </p>

    <ul
      v-if="m.items.value.length"
      :class="[
        'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3 p-0',
        dragging && 'rounded-card outline outline-2 outline-gold',
      ]"
    >
      <li v-for="doc in m.items.value" :key="doc.meta.id">
        <button
          type="button"
          :aria-pressed="pick ? undefined : openId === doc.meta.id"
          :aria-label="pick ? `Use ${label(doc)}` : `Open ${label(doc)}`"
          class="flex w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left hover:border-line-2 aria-pressed:border-gold aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-gold"
          @click="pick ? emit('pick', doc.meta.id) : look(doc.meta.id)"
        >
          <span class="block aspect-[4/5] w-full bg-raised">
            <MediaImage :id="doc.meta.id" :alt="label(doc)" />
          </span>
          <span class="truncate px-2 py-1.5 text-xs text-ink-2">{{ label(doc) }}</span>
        </button>
      </li>
    </ul>

    <section
      v-if="open && !pick"
      aria-label="Image details"
      class="flex flex-col gap-4 border-t border-line pt-4 sm:flex-row"
    >
      <div
        class="flex h-[260px] w-full items-center justify-center rounded-card bg-raised sm:w-[260px] sm:shrink-0"
      >
        <MediaImage :id="open.meta.id" :alt="label(open)" variant="full" fit="contain" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <p class="m-0 break-words text-xs text-ink-3">
          {{ open.meta.name }} · {{ open.meta.type }} · {{ size(open.meta.size) }}
        </p>
        <Field label="Caption" description="What it shows, in a line.">
          <Input
            v-model="caption"
            :disabled="!m.canEdit.value"
            autocomplete="off"
            @change="m.saveDetails(open.meta.id, { caption })"
          />
        </Field>
        <Field label="Credit" description="Who made it, or where it came from.">
          <Input
            v-model="credit"
            :disabled="!m.canEdit.value"
            autocomplete="off"
            @change="m.saveDetails(open.meta.id, { credit })"
          />
        </Field>
        <div v-if="m.canEdit.value">
          <Button variant="danger" @click="m.remove(open.meta.id)">Delete image</Button>
        </div>
      </div>
    </section>
  </section>
</template>
