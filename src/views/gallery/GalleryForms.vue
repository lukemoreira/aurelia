<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import RadioGroup from '@/components/ui/RadioGroup.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import Tabs from '@/components/ui/Tabs.vue'
import Textarea from '@/components/ui/Textarea.vue'
import GallerySection from './GallerySection.vue'

const name = ref('Elena')
const bad = ref('')
const note = ref('')
const pov = ref('third-limited')
const check = ref(true)
const sw = ref(true)
const radio = ref('close')
const view = ref('outline')
const mode = ref('write')
const tab = ref('scene')
const povOptions = [
  { value: 'first', label: 'First person' },
  { value: 'third-limited', label: 'Third person, limited' },
  { value: 'omniscient', label: 'Omniscient', disabled: true },
]
</script>

<template>
  <GallerySection title="Fields">
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label="Name" description="How the character appears in the navigator.">
        <Input v-model="name" />
      </Field>
      <Field label="Title" error="Give the scene a title.">
        <Input v-model="bad" placeholder="Untitled scene" />
      </Field>
      <Field label="Point of view">
        <Select v-model="pov" :options="povOptions" placeholder="Choose one" />
      </Field>
      <Field label="Disabled">
        <Input model-value="Locked" disabled />
      </Field>
      <div class="sm:col-span-2">
        <Field label="Summary">
          <Textarea v-model="note" placeholder="What happens in this scene?" />
        </Field>
      </div>
    </div>
  </GallerySection>
  <GallerySection title="Choices">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="flex flex-col">
        <Checkbox v-model="check" label="Count this scene in the book total" />
        <Checkbox :model-value="false" label="Disabled" disabled />
        <Switch v-model="sw" label="Check spelling while I write" />
        <Switch :model-value="false" label="Disabled" disabled />
      </div>
      <RadioGroup
        v-model="radio"
        label="Narrative distance"
        :options="[
          { value: 'close', label: 'Close', description: 'Inside the character’s head.' },
          { value: 'far', label: 'Far' },
          { value: 'cold', label: 'Cold', disabled: true },
        ]"
      />
    </div>
  </GallerySection>
  <GallerySection title="Segmented control and tabs">
    <div class="flex flex-wrap items-center gap-3">
      <SegmentedControl
        v-model="mode"
        label="Editor mode"
        :options="[
          { value: 'write', label: 'Write', icon: 'write' },
          { value: 'markdown', label: 'Markdown', icon: 'embed' },
        ]"
      />
      <SegmentedControl
        v-model="view"
        label="Plan view"
        :options="[
          { value: 'outline', label: 'Outline', icon: 'list' },
          { value: 'corkboard', label: 'Corkboard', icon: 'plan' },
          { value: 'timeline', label: 'Timeline', icon: 'calendar' },
        ]"
      />
    </div>
    <Tabs
      v-model="tab"
      label="Scene inspector"
      :items="[
        { value: 'scene', label: 'Scene' },
        { value: 'changes', label: 'Changes' },
        { value: 'notes', label: 'Notes' },
      ]"
    >
      <template #scene
        ><p class="text-[13px] text-ink-2">Objective, conflict, outcome.</p></template
      >
      <template #changes
        ><p class="text-[13px] text-ink-2">What changed in this scene.</p></template
      >
      <template #notes><p class="text-[13px] text-ink-2">Private notes.</p></template>
    </Tabs>
  </GallerySection>
</template>
