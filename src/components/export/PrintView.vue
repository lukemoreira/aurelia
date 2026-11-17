<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { usePrintView } from '@/composables/usePrintView'
import { useLayoutStore } from '@/stores/layout'

const layout = useLayoutStore()
const { bindPrint, close, print } = usePrintView()
</script>

<template>
  <!-- Outside the app's own element, so the app can be set aside while this is up and hidden when printing. -->
  <Teleport to="body">
    <div
      v-if="layout.print"
      class="print-view fixed inset-0 z-[60] overflow-y-auto bg-canvas text-ink"
      role="dialog"
      aria-modal="true"
      aria-label="Print view"
    >
      <div
        class="print-bar sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-chrome px-4 py-2.5"
      >
        <div class="mr-auto min-w-0">
          <p class="m-0 truncate text-sm font-semibold">{{ layout.print.title }}</p>
          <p class="m-0 text-xs text-ink-2">
            Press Print, choose “Save as PDF” as the destination, and untick “Headers and footers”.
          </p>
        </div>
        <Button @click="close">Close</Button>
        <Button :ref="bindPrint" variant="primary" @click="print">Print or save as PDF</Button>
      </div>
      <div
        class="print-sheet mx-auto my-6 w-[calc(100%-2rem)] max-w-[820px] bg-white px-6 py-10 shadow-card sm:px-14"
      >
        <!-- The book's own text, every character of it escaped when it was made: it is text, never markup. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <article class="print-book" aria-label="The book" v-html="layout.print.html" />
      </div>
    </div>
  </Teleport>
</template>
