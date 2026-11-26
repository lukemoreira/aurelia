<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Menu from '@/components/ui/Menu.vue'
import Tabs from '@/components/ui/Tabs.vue'
import Tag from '@/components/ui/Tag.vue'
import { useAppearances } from '@/composables/useAppearances'
import { useNavigation } from '@/composables/useNavigation'
import { useOutlineEdits } from '@/composables/useOutlineEdits'
import { useRecordSheet } from '@/composables/useRecordSheet'
import { placeAncestors } from '@/domain/places'
import type { SheetTab } from '@/domain/record-types'
import { useWorkspaceStore } from '@/stores/workspace'
import LinksList from '@/components/shell/LinksList.vue'
import SceneEditor from '@/components/write/SceneEditor.vue'
import AppearancesTab from './AppearancesTab.vue'
import ProgressionTab from './ProgressionTab.vue'
import PlaceMapTab from './PlaceMapTab.vue'
import RecordTime from './RecordTime.vue'
import FieldList from './FieldList.vue'
import RecordPortrait from './RecordPortrait.vue'
import RecordOverview from './RecordOverview.vue'
import RelationshipsTab from './RelationshipsTab.vue'
import SourcesEditor from './SourcesEditor.vue'

/**
 * A record's sheet, for every kind of record: who or what it is (the Overview), the tabs its kind
 * has (a character's relationships, appearances and voice; a place's senses; a research note's
 * sources), its notes and what links to it.
 */
const props = defineProps<{ id: string }>()
const s = useRecordSheet(() => props.id)
const edit = useOutlineEdits()
const ws = useWorkspaceStore()
const nav = useNavigation()

const TAB_LABEL: Record<SheetTab | 'notes', string> = {
  overview: 'Overview',
  progression: 'Progression',
  relationships: 'Relationships',
  appearances: 'Appearances',
  voice: 'Voice',
  senses: 'Senses',
  map: 'Map',
  sources: 'Sources',
  notes: 'Notes',
}
const route = useRoute()
// A link can ask for a tab (`?tab=map`, "Open its map"); a record opens on its Overview otherwise.
const requested = () => (typeof route.query.tab === 'string' ? route.query.tab : 'overview')
const picked = ref(requested())
watch(
  () => `${props.id}|${route.query.tab}`, // a string: an array is new on every run and would reset the tab on any navigation
  () => (picked.value = requested()),
)
/** Overview first, the tabs this kind has, and the notes last (as the design's tab row has it). */
const tabs = computed(() =>
  (['overview', ...(s.info.value?.tabs ?? []), 'notes'] as const).map((t) => ({
    value: t,
    label: TAB_LABEL[t],
  })),
)
// A tab this kind of record does not have (a character asked for `map`) is the Overview.
const tab = computed({
  get: () => (tabs.value.some((t) => t.value === picked.value) ? picked.value : 'overview'),
  set: (v) => (picked.value = v),
})
const fieldsOn = (t: SheetTab) =>
  (s.info.value?.fields ?? []).filter((f) => (f.tab ?? 'overview') === t)
const type = computed(() => s.record.value?.meta.type)
const isPlace = computed(() => type.value === 'place' || type.value === 'world')
const crumbs = computed(() =>
  isPlace.value ? placeAncestors(ws.data?.records ?? [], props.id) : [],
)
const hasImage = computed(
  () =>
    !!s.record.value?.meta.image &&
    !!ws.data?.media?.some((m) => m.meta.id === s.record.value?.meta.image),
)
const menu = computed(() => [
  ...(hasImage.value
    ? [{ id: 'remove-image', label: `Remove ${noun.value}`, icon: 'image' as const }]
    : []),
  { id: 'delete', label: 'Delete', icon: 'trash' as const, danger: true },
])
const onMenu = (action: string) =>
  action === 'remove-image' ? s.saveImage(undefined) : edit.remove(props.id)
const noun = computed(() => (type.value === 'character' ? 'portrait' : 'picture'))
const appearances = useAppearances(() => props.id)
/** "2 books · 50 scenes": where it appears, across the universe. */
const appears = computed(() => {
  const books = appearances.groups.value.length
  const scenes = appearances.total.value
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  return scenes ? `${n(books, 'book')} · ${n(scenes, 'scene')}` : ''
})
/** What it is in the story, in a word or two: a character's role, another kind's kind. */
const role = computed(() => s.record.value?.meta.role?.trim() || s.record.value?.meta.kind?.trim())
</script>

<template>
  <article v-if="s.record.value" class="flex w-full max-w-[720px] flex-col gap-6">
    <header class="flex flex-wrap items-start gap-[18px]">
      <RecordPortrait
        :title="s.record.value.meta.title"
        :image="s.record.value.meta.image"
        :colour="s.colour.value"
        :editable="!s.readOnly.value"
        :noun="noun"
        @choose="s.saveImage($event)"
      />
      <div class="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <nav
          v-if="crumbs.length"
          aria-label="Where this is"
          class="flex flex-wrap items-center gap-1 text-xs text-ink-3"
        >
          <template v-for="(c, i) in crumbs" :key="c.id">
            <button
              type="button"
              class="inline-flex min-h-8 items-center font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline pointer-coarse:min-h-11"
              @click="nav.openTarget({ kind: 'record', id: c.id })"
            >
              {{ c.title }}
            </button>
            <span v-if="i < crumbs.length - 1" aria-hidden="true">›</span>
          </template>
        </nav>
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
          <Tag v-if="role" variant="pill">{{ role }}</Tag>
          <Tag v-if="appears" variant="pill">{{ appears }}</Tag>
          <Tag variant="pill"><Icon name="globe" :size="13" />{{ s.scope.value }}</Tag>
        </div>
      </div>
      <div v-if="!s.readOnly.value" class="flex gap-1.5">
        <Button @click="edit.rename(id)">Rename…</Button>
        <Menu align="end" :items="menu" @select="onMenu">
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
      <Tabs v-model="tab" label="About this record" :items="tabs">
        <template #overview>
          <RecordOverview
            :id="id"
            v-model:summary="s.draft.summary"
            v-model:draft="s.draft.fields"
            v-model:aliases="s.draft.aliases"
            :fields="fieldsOn('overview')"
            :disabled="s.readOnly.value"
            :place="isPlace"
            @save-summary="s.saveSummary()"
            @save-field="s.saveField($event)"
            @save-aliases="s.saveAliases()"
            @add-alias="s.addAlias()"
            @remove-alias="s.removeAlias"
            @never-alias="s.neverAlias"
          >
            <RecordTime
              v-if="type === 'character'"
              :id="id"
              field="born"
              label="Born"
              hint="Their birth date. The checks use it to catch age mistakes."
            />
            <RecordTime
              v-else-if="type === 'event'"
              :id="id"
              field="time"
              label="When it happens"
              hint="A date in one of the universe’s calendars. Events with a date show on the timeline."
            />
          </RecordOverview>
        </template>
        <template #progression>
          <ProgressionTab :id="id" :name="s.record.value.meta.title" />
        </template>
        <template #relationships>
          <RelationshipsTab :id="id" :name="s.record.value.meta.title" />
        </template>
        <template #appearances>
          <AppearancesTab :id="id" :name="s.record.value.meta.title" />
        </template>
        <template #voice>
          <FieldList
            v-model="s.draft.fields"
            :fields="fieldsOn('voice')"
            :disabled="s.readOnly.value"
            @save="s.saveField($event)"
          />
        </template>
        <template #senses>
          <FieldList
            v-model="s.draft.fields"
            :fields="fieldsOn('senses')"
            :disabled="s.readOnly.value"
            @save="s.saveField($event)"
          />
        </template>
        <template #sources>
          <SourcesEditor
            v-model="s.draft.sources"
            :disabled="s.readOnly.value"
            @save="s.saveSources()"
            @add="s.addSource()"
            @remove="s.removeSource"
          />
        </template>
        <template #map>
          <PlaceMapTab :id="id" />
        </template>
        <template #notes>
          <div class="flex flex-col gap-1.5">
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
        </template>
      </Tabs>
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
