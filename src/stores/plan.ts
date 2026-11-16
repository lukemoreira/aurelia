// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePersisted } from '@/composables/usePersisted'

export type PlanView = 'outline' | 'cork'
export type ColourBy = 'arc' | 'status'

/** The Plan view's own state: which way it shows the book, how cards are coloured, what is selected. */
export const usePlanStore = defineStore('plan', () => {
  // Per device: the way the author likes to plan.
  const view = usePersisted<PlanView>(
    'plan-view',
    'outline',
    (v): v is PlanView => v === 'outline' || v === 'cork',
  )
  const colourBy = usePersisted<ColourBy>(
    'plan-colour',
    'arc',
    (v): v is ColourBy => v === 'arc' || v === 'status',
  )
  /** A scene, chapter, part or arc: what the side panel shows. */
  const selected = ref<string | null>(null)
  return { view, colourBy, selected }
})
