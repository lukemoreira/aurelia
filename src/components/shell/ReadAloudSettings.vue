<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import Field from '@/components/ui/Field.vue'
import Select from '@/components/ui/Select.vue'
import { RATE_MAX, RATE_MIN, useReadAloud } from '@/composables/useReadAloud'

const { voices, voice, rate } = useReadAloud()
const speedId = useId()
const options = computed(() => [
  { value: 'auto', label: 'Automatic' },
  ...voices.value.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
])
// A voice that is gone (another device, a removed pack) reads as Automatic.
const chosen = computed({
  get: () => (voices.value.some((v) => v.voiceURI === voice.value) ? voice.value : 'auto'),
  set: (value) => (voice.value = value ?? 'auto'),
})
const speed = computed(() => `${rate.value.toFixed(1)}×`)
</script>

<template>
  <section
    aria-labelledby="read-aloud-settings"
    class="mt-3 flex flex-col gap-3 border-t border-line pt-3"
  >
    <h3 id="read-aloud-settings" class="m-0 text-[13px] font-semibold">Read aloud</h3>
    <Field
      label="Voice"
      :description="
        voices.length
          ? 'Only voices that keep your text on this device are listed.'
          : 'No voice on this device. Add one in your system’s speech settings; Read aloud will not use an online voice.'
      "
    >
      <Select v-model="chosen" :options="options" :disabled="!voices.length" />
    </Field>
    <div class="flex flex-col gap-1.5">
      <label :for="speedId" class="flex justify-between text-[13px] font-medium">
        Speed <span class="font-normal text-ink-3">{{ speed }}</span>
      </label>
      <input
        :id="speedId"
        v-model.number="rate"
        type="range"
        :min="RATE_MIN"
        :max="RATE_MAX"
        step="0.1"
        :aria-valuetext="speed"
        class="accent-gold-ink pointer-coarse:h-11"
      />
    </div>
  </section>
</template>
