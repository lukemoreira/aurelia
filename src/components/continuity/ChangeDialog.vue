<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { nextTick, ref } from 'vue'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Textarea from '@/components/ui/Textarea.vue'
import type { useChangeForm } from '@/composables/useChangeForm'
import { CHANGE_PICKS } from '@/domain/change-kinds'

/** "What changes in this scene?": who, what happens to them, the details, in plain words. */
const props = defineProps<{ form: ReturnType<typeof useChangeForm>; where: string }>()
const form = props.form
const f = form.f
const details = ref<HTMLElement | null>(null)
let byPointer = false
/**
 * A kind picked with the mouse or a finger takes the keyboard to its first field, and the page to it:
 * on a small screen the details are below the fold. Arrow keys through the kinds leave focus where it is.
 */
async function pick(kind: Parameters<typeof form.choose>[0]) {
  form.choose(kind)
  if (!byPointer) return
  byPointer = false
  await nextTick()
  const first = details.value?.querySelector<HTMLElement>(
    'input:not([type=radio]), textarea, [role=combobox], button',
  )
  first?.focus()
  first?.scrollIntoView({ block: 'nearest' })
}
const legend = 'mb-2 p-0 text-[13px] font-semibold text-ink'
const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-full border py-0 pl-1 pr-3 text-[12.5px] pointer-coarse:h-11'
</script>

<template>
  <Dialog
    v-model:open="form.open.value"
    size="md"
    :title="
      form.editing.value ? 'Change what changes in this scene' : 'What changes in this scene?'
    "
    :description="`${where} · this is how Aurelia keeps your story consistent`"
  >
    <form id="change-form" class="flex flex-col gap-5" @submit.prevent="form.save()">
      <fieldset v-if="!form.aboutNobody.value" class="m-0 min-w-0 border-0 p-0">
        <legend :class="legend">1. {{ form.forArc.value ? 'Which arc?' : 'Who?' }}</legend>
        <div class="flex flex-wrap gap-1.5">
          <template v-if="!form.forArc.value">
            <button
              v-for="id in form.present.value"
              :key="id"
              type="button"
              :aria-pressed="f.who === id"
              :class="[
                chip,
                f.who === id
                  ? 'border-2 border-gold-ink bg-gold-soft font-semibold'
                  : 'border-line-2 bg-surface font-medium',
              ]"
              @click="f.who = id"
            >
              <Avatar :name="form.nameOf(id)" :color="form.colour(id)" :size="24" />{{
                form.nameOf(id)
              }}
            </button>
          </template>
          <p v-if="!form.forArc.value && !form.present.value.length" class="m-0 text-xs text-ink-2">
            Nobody is on the page of this scene yet. Pick someone below.
          </p>
        </div>
        <div class="mt-2 max-w-xs">
          <Field :label="form.forArc.value ? 'Arc' : 'Someone else'">
            <Select
              :model-value="
                form.forArc.value || !form.present.value.includes(f.who) ? f.who : undefined
              "
              :options="form.forArc.value ? form.options.value.arcs : form.options.value.people"
              :placeholder="form.forArc.value ? 'Pick an arc' : 'Pick a character'"
              @update:model-value="(v) => (f.who = v ?? '')"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset class="m-0 min-w-0 border-0 p-0">
        <legend :class="legend">
          {{ form.aboutNobody.value ? '1' : '2' }}. What happens{{
            f.who && !form.forArc.value && !form.aboutNobody.value
              ? ` to ${form.nameOf(f.who)}`
              : ''
          }}?
        </legend>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <label
            v-for="k in CHANGE_PICKS"
            :key="k.value"
            :class="[
              'flex min-h-11 cursor-pointer items-start gap-2 rounded-control border px-3 py-2 has-[:checked]:border-2 has-[:checked]:border-gold-ink has-[:checked]:bg-gold-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
              f.pick === k.value ? 'border-gold-ink' : 'border-line-2 bg-surface',
            ]"
            @pointerdown="byPointer = true"
          >
            <input
              type="radio"
              name="kind"
              class="sr-only"
              :value="k.value"
              :checked="f.pick === k.value"
              @change="pick(k.value)"
            />
            <span class="flex flex-col leading-tight">
              <span class="text-[13px] font-medium">{{ k.label }}</span>
              <span class="text-[11.5px] text-ink-3">{{ k.hint }}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset ref="details" class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend :class="legend">{{ form.aboutNobody.value ? '2' : '3' }}. Details</legend>
        <template v-if="f.pick === 'relation'">
          <Field label="With">
            <Select
              v-model="f.with"
              :options="form.options.value.others"
              placeholder="Pick a character"
            />
          </Field>
          <p class="m-0 text-[13px]">
            <span class="text-ink-3">Was </span>
            <span class="font-medium">{{ form.was.value || 'nothing recorded' }}</span>
            <span v-if="form.was.value" class="text-ink-3"> — as of this scene</span>
          </p>
          <Field label="Now"><Input v-model="f.value" autocomplete="off" /></Field>
        </template>
        <Field v-else-if="f.pick === 'knows'" label="What they learn">
          <Input v-model="f.value" autocomplete="off" />
        </Field>
        <Field v-else-if="f.pick === 'condition'" label="Their condition now">
          <Input v-model="f.value" autocomplete="off" placeholder="Injured — left hand" />
        </Field>
        <template v-else-if="f.pick === 'item'">
          <div role="radiogroup" aria-label="Gains or loses" class="flex gap-4 text-[13px]">
            <label class="inline-flex items-center gap-1.5"
              ><input v-model="f.gains" type="radio" name="gains" :value="true" />Gains it</label
            >
            <label class="inline-flex items-center gap-1.5"
              ><input v-model="f.gains" type="radio" name="gains" :value="false" />Loses it</label
            >
          </div>
          <Field
            label="Item"
            :description="
              form.options.value.items.length
                ? undefined
                : 'No item yet. Add it in World, then come back.'
            "
          >
            <Select
              v-model="f.item"
              :options="form.options.value.items"
              placeholder="Pick an item"
            />
          </Field>
        </template>
        <Field v-else-if="f.pick === 'status'" label="What happens">
          <Select v-model="f.status" :options="form.options.value.status" />
        </Field>
        <Field v-else-if="f.pick === 'location'" label="Where they are">
          <Select
            v-model="f.place"
            :options="form.options.value.places"
            placeholder="Pick a place"
          />
        </Field>
        <Field v-else-if="f.pick === 'goal'" label="What they want now">
          <Input v-model="f.value" autocomplete="off" />
        </Field>
        <Field v-else-if="f.pick === 'trait'" label="Belief or trait">
          <Input v-model="f.value" autocomplete="off" placeholder="Stops trusting the Guild" />
        </Field>
        <Field v-else-if="f.pick === 'beat'" label="What happens in this beat">
          <Input v-model="f.value" autocomplete="off" />
        </Field>
        <Field v-else-if="f.pick === 'setup'" label="What is promised to the reader">
          <Input v-model="f.value" autocomplete="off" placeholder="The key under the lantern" />
        </Field>
        <Field
          v-else-if="f.pick === 'payoff'"
          label="Which set-up"
          :description="
            form.setups.value.length
              ? undefined
              : 'Nothing has been set up yet. Record a set-up in an earlier scene.'
          "
        >
          <Select
            v-model="f.of"
            :options="form.setups.value.map((s) => ({ value: s.value, label: s.label }))"
            placeholder="Pick a set-up"
          />
        </Field>
        <p v-if="form.preview.value" class="m-0 rounded-control bg-raised px-3 py-2 text-[12.5px]">
          {{ form.preview.value }}
        </p>
        <Field label="Quote from the scene (optional)">
          <Textarea v-model="f.quote" rows="2" />
        </Field>
      </fieldset>
      <p v-if="form.error.value" role="alert" class="m-0 text-xs font-medium text-danger">
        {{ form.error.value }}
      </p>
    </form>
    <template #footer>
      <Button @click="form.open.value = false">Cancel</Button>
      <Button variant="primary" type="submit" form="change-form" :loading="form.saving.value">
        {{ form.editing.value ? 'Save change' : 'Add change' }}
      </Button>
    </template>
  </Dialog>
</template>
