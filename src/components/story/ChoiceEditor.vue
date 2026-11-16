<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import Field from '@/components/ui/Field.vue'
import { nextTick, onMounted, ref, watch } from 'vue'
import { NEW_SCENE, useChoices } from '@/composables/useChoices'
import { useLayoutStore } from '@/stores/layout'

/** A scene's choices, as the inspector and the story map's side panel edit them. */
const props = defineProps<{ id: string | undefined; startToo?: boolean; askable?: boolean }>()
const c = useChoices(() => props.id)
const layout = useLayoutStore()
const root = ref<HTMLElement | null>(null)

// The writing page's "Edit choices": scroll here and put the keyboard in the new-choice field (or the first choice).
async function takeAsk() {
  if (!props.askable || !layout.choicesWanted) return
  await nextTick()
  const el =
    root.value?.querySelector<HTMLElement>('[data-focus="new-choice"]') ??
    root.value?.querySelector<HTMLElement>('input')
  if (!el) return
  layout.choicesWanted = false
  el.scrollIntoView({ block: 'center' })
  el.focus()
}
onMounted(() => setTimeout(takeAsk, 120)) // inside a sheet that is still opening
watch(() => layout.choicesWanted, takeAsk)
</script>

<template>
  <section v-if="c.scene.value" ref="root" aria-label="Choices" class="flex flex-col gap-2.5">
    <h3 class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
      Choices from here
    </h3>

    <p v-if="!c.choices.value.length" class="m-0 text-[12.5px] text-ink-2">
      {{ c.ending.value ? 'None. The story can finish here.' : 'None yet. Add one below.' }}
    </p>
    <ul v-else class="m-0 flex list-none flex-col gap-2.5 p-0">
      <li
        v-for="(choice, i) in c.choices.value"
        :key="choice.id"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-1.5"
      >
        <Field :label="`Choice ${i + 1} text`" class="col-span-2 [&>label]:sr-only">
          <Input
            v-model="c.labels[choice.id]"
            :data-focus="`choice-${choice.id}`"
            :disabled="c.readOnly.value"
            autocomplete="off"
            @change="c.relabel(choice.id)"
          />
        </Field>
        <span aria-hidden="true" class="col-span-2 -mb-0.5 text-[11.5px] text-ink-3"
          >Goes to →</span
        >
        <Field :label="`Choice ${i + 1} goes to`" class="[&>label]:sr-only">
          <Select
            :data-focus="`choice-${choice.id}-to`"
            :model-value="c.targetOf(choice.target)"
            :options="c.optionsFor(choice.target)"
            :disabled="c.readOnly.value"
            @update:model-value="(v) => v && c.retarget(choice.id, v)"
          />
        </Field>
        <button
          v-if="!c.readOnly.value"
          type="button"
          :aria-label="`Remove choice ${i + 1}: ${choice.label}`"
          class="flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-raised hover:text-ink pointer-coarse:size-11"
          @click="c.remove(choice.id)"
        >
          <Icon name="close" :size="14" />
        </button>
      </li>
    </ul>

    <form
      v-if="!c.readOnly.value"
      class="flex flex-col gap-2 border-t border-line pt-2.5"
      aria-label="Add a choice"
      @submit.prevent="c.addNow()"
    >
      <Field label="New choice">
        <Input
          v-model="c.add.label"
          data-focus="new-choice"
          autocomplete="off"
          placeholder="What the reader picks"
        />
      </Field>
      <Field label="Goes to">
        <Select v-model="c.add.target" :options="c.addOptions.value" />
      </Field>
      <p v-if="c.add.target === NEW_SCENE" class="m-0 text-[11.5px] text-ink-3">
        A new scene is made in this chapter when you add the choice.
      </p>
      <div>
        <Button type="submit"><Icon name="plus" :size="14" />Add choice</Button>
      </div>
    </form>

    <Switch v-model="c.ending.value" label="This scene is an ending" :disabled="c.readOnly.value" />
    <div v-if="startToo && !c.readOnly.value">
      <Button v-if="!c.isStart.value" @click="c.makeStart()">Make this the start</Button>
      <p v-else class="m-0 text-[12.5px] text-ink-2">The reader starts here.</p>
    </div>
    <p v-if="c.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
      {{ c.error.value }}
    </p>
  </section>
</template>
