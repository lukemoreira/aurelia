<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import MediaGallery from '@/components/media/MediaGallery.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Icon from '@/components/ui/Icon.vue'
import { usePlaceMap } from '@/composables/usePlaceMap'
import PlaceMapCanvas from './PlaceMapCanvas.vue'
import PlaceMapPinPicker from './PlaceMapPinPicker.vue'
import PlaceMapPopover from './PlaceMapPopover.vue'

/**
 * The Map tab of a place or world: a picture from the gallery, the places pinned on it, and what a pin
 * opens (the place, its own map, the scenes set there). All of it saves to the record's own file.
 */
const props = defineProps<{ id: string }>()
const m = usePlaceMap(() => props.id)
const canvas = ref<InstanceType<typeof PlaceMapCanvas>>()
const file = ref<HTMLInputElement>()
const choosing = ref(false)
const picking = ref(false)
const removing = ref(false)
// The picture cannot be drawn (a file the browser cannot read): the tab says so, like a picture that is gone.
const broken = ref(false)
watch(
  () => `${props.id}|${m.mapId.value}`,
  () => (broken.value = false),
)
const unusable = computed(() => !m.hasMap.value || broken.value)
const lost = computed(() => m.pictureGone.value || broken.value)

const choose = (id: string) => {
  choosing.value = false
  void m.choosePicture(id)
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // so the same file can be chosen again
  void m.addPicture(files)
}
/** A place was chosen in the picker (or from "Not on the map yet"): the next click on the map drops it. */
function startPlacing(place: string) {
  picking.value = false
  m.editing.value = true
  m.placing.value = place
}
async function drop(place: string, x: number, y: number) {
  // Only a pin that is on the map can be focused (a refused write says why, and leaves focus alone).
  if (await m.drop(place, x, y)) await canvas.value?.focusPin(place) // the arrow keys move it from here
}
const addPinButton = ref<InstanceType<typeof Button>>()
const editButton = ref<InstanceType<typeof Button>>()
const focusOn = (button?: InstanceType<typeof Button>) =>
  (button?.$el as HTMLElement | undefined)?.focus()
/** Escape while a place waits for its click: forget it, and go back to "Add pin". */
async function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !m.placing.value) return
  m.placing.value = undefined
  await nextTick()
  focusOn(addPinButton.value)
}
// Always on the page and filled when placing starts: a live region that arrives already full is often not read.
const placingNote = computed(() =>
  m.placing.value
    ? `Click the map to put “${m.placingTitle.value}” there, or use Drop it in the middle. Escape cancels.`
    : '',
)
/** Take a pin off; focus goes to the next pin in the list, or to the edit button when none is left. */
async function removePin(place: string) {
  const list = m.pins.value
  const at = list.findIndex((p) => p.place === place)
  const next = list[at + 1] ?? list[at - 1]
  if (!(await m.remove(place))) return
  if (next) await canvas.value?.focusPin(next.place)
  else {
    await nextTick()
    focusOn(editButton.value)
  }
}
const dropInCentre = () => {
  const at = canvas.value?.visibleCentre()
  if (m.placing.value && at) void drop(m.placing.value, at.x, at.y)
}
function toggleEditing() {
  m.editing.value = !m.editing.value
  if (!m.editing.value) {
    m.placing.value = undefined
    m.flush()
  }
}
async function closePin(place: string) {
  m.flush()
  m.selected.value = undefined
  await nextTick()
  await canvas.value?.focusPin(place)
}
const select = (place: string | undefined) => {
  m.flush()
  m.selected.value = place
}
async function removeMap() {
  removing.value = false
  await m.removeMap()
}
onBeforeUnmount(() => m.flush())
const link = 'min-h-8 underline-offset-2 hover:underline pointer-coarse:min-h-11'
const chip =
  'inline-flex min-h-8 items-center rounded-full border border-line-2 bg-surface px-3 text-xs text-ink hover:bg-raised pointer-coarse:min-h-11'
</script>

<template>
  <div v-if="m.record.value" class="relative flex flex-col gap-4" @keydown="onKey">
    <p role="status" class="sr-only">{{ placingNote }}</p>
    <button
      v-if="m.parentMap.value"
      type="button"
      :class="['self-start text-left text-[13px] font-medium text-ink-2 hover:text-ink', link]"
      @click="m.openMapOf(m.parentMap.value.id)"
    >
      Inside {{ m.parentMap.value.title }} — open its map
    </button>

    <!-- No map, or a map whose picture is gone or cannot be shown. -->
    <section
      v-if="unusable"
      class="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-2 p-5"
    >
      <p v-if="m.pictureGone.value" role="status" class="m-0 text-[13px] text-ink">
        This map’s picture is gone. Choose another picture.
      </p>
      <p v-else-if="broken" role="status" class="m-0 text-[13px] text-ink">
        This map’s picture cannot be shown. Choose another picture.
      </p>
      <p v-else class="m-0 text-[13px] text-ink">No map yet.</p>
      <p v-if="!lost" class="m-0 text-xs text-ink-3">
        A map is a picture from your gallery. Pin places on it, and click a pin to open that place.
      </p>
      <div v-if="m.canEdit.value" class="flex flex-wrap gap-2">
        <Button variant="primary" @click="choosing = true">Choose a picture</Button>
        <Button :loading="!!m.busy.value" @click="file?.click()">Add a picture…</Button>
        <Button v-if="lost" variant="danger" @click="removing = true"> Remove map </Button>
      </div>
    </section>

    <template v-else>
      <div v-if="m.canEdit.value" class="flex flex-wrap items-center gap-2">
        <Button
          ref="editButton"
          :variant="m.editing.value ? 'primary' : 'secondary'"
          @click="toggleEditing"
        >
          <Icon name="pin" :size="14" />{{ m.editing.value ? 'Done' : 'Edit pins' }}
        </Button>
        <Button v-if="m.editing.value" ref="addPinButton" @click="picking = true">
          <Icon name="plus" :size="14" />Add pin
        </Button>
        <span class="flex-1" />
        <Button variant="quiet" @click="choosing = true">Change picture</Button>
        <Button variant="quiet" @click="removing = true">Remove map</Button>
      </div>
      <p v-if="m.placing.value" class="m-0 flex flex-wrap items-center gap-2 text-[13px] text-ink">
        Click the map to put “{{ m.placingTitle.value }}” there.
        <Button size="sm" @click="dropInCentre">Drop it in the middle</Button>
        <Button size="sm" variant="quiet" @click="m.placing.value = undefined">Cancel</Button>
      </p>
      <p v-if="m.canEdit.value && !m.pins.value.length" class="m-0 text-[13px] text-ink-2">
        No pins yet. Press Edit pins, then Add pin, then click the map.
      </p>

      <!-- Keyed by the record and the picture: another record's zoom, pan and names setting do not carry over. -->
      <PlaceMapCanvas
        v-if="m.mapId.value"
        :key="`${id}|${m.mapId.value}`"
        ref="canvas"
        :map-id="m.mapId.value"
        :alt="m.title.value"
        :pins="m.pins.value"
        :editing="m.editing.value"
        :placing="!!m.placing.value"
        :selected="m.selected.value"
        @select="select"
        @drop="(x, y) => m.placing.value && drop(m.placing.value, x, y)"
        @drag="m.drag"
        @settle="m.settle"
        @nudge="m.nudge"
        @broken="broken = true"
      >
        <template #popover="{ pin }">
          <PlaceMapPopover
            :key="pin.place"
            v-bind="m.about(pin.place)"
            :editing="m.editing.value"
            @close="closePin(pin.place)"
            @place="m.openPlace(pin.place)"
            @map="m.openMapOf(pin.place)"
            @scene="(s) => m.openScene(s.bookId, s.id)"
            @remove="removePin(pin.place)"
          />
        </template>
      </PlaceMapCanvas>
    </template>

    <section
      v-if="!unusable && m.pins.value.length"
      aria-labelledby="pinned-title"
      class="flex flex-col gap-1.5"
    >
      <h2 id="pinned-title" class="m-0 text-[13px] font-medium text-ink">Pinned places</h2>
      <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
        <li v-for="p in m.pins.value" :key="p.place">
          <button type="button" :class="chip" @click="select(p.place)">
            {{ p.title }}<span v-if="p.kind" class="ml-1 text-ink-3">· {{ p.kind }}</span>
          </button>
        </li>
      </ul>
    </section>
    <section
      v-if="!unusable && m.notPinned.value.length"
      aria-labelledby="unpinned-title"
      class="flex flex-col gap-1.5"
    >
      <h2 id="unpinned-title" class="m-0 text-[13px] font-medium text-ink">Not on the map yet:</h2>
      <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
        <li
          v-for="c in m.notPinned.value"
          :key="c.id"
          class="flex items-center gap-1 text-xs text-ink-2"
        >
          {{ c.title }}
          <Button
            v-if="m.editing.value"
            size="sm"
            :aria-label="`Add ${c.title} to the map`"
            @click="startPlacing(c.id)"
            >Add</Button
          >
        </li>
      </ul>
    </section>

    <p v-if="m.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ m.error.value }}
    </p>

    <input
      ref="file"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg"
      class="sr-only"
      aria-label="Choose a map picture to add"
      @change="onFile"
    />
    <Dialog
      v-model:open="choosing"
      title="Choose a map picture"
      description="Pick an image from the gallery, or add one first."
      size="lg"
    >
      <MediaGallery pick @pick="choose" />
    </Dialog>
    <PlaceMapPinPicker
      v-model:open="picking"
      :title="m.title.value"
      v-bind="m.candidates.value"
      @pick="startPlacing"
    />
    <Dialog
      v-model:open="removing"
      title="Remove this map?"
      :description="`The picture and every pin on it come off ${m.title.value}. The picture stays in the gallery, and the places stay as they are.`"
    >
      <template #footer>
        <Button @click="removing = false">Cancel</Button>
        <Button variant="danger" @click="removeMap">Remove map</Button>
      </template>
    </Dialog>
  </div>
</template>
