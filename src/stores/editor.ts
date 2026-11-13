// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { usePersisted } from '@/composables/usePersisted'

/** What can be chosen for the text, as the words on the settings screen. The values are the ones saved. */
export const EDITOR_CHOICES = {
  font: [
    { value: 'serif', label: 'Serif' },
    { value: 'sans', label: 'Sans' },
    { value: 'mono', label: 'Mono' },
  ],
  size: [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'larger', label: 'Larger' },
  ],
  leading: [
    { value: 'tight', label: 'Tight' },
    { value: 'normal', label: 'Normal' },
    { value: 'roomy', label: 'Roomy' },
  ],
  paragraphs: [
    { value: 'indent', label: 'Indent' },
    { value: 'space', label: 'Space' },
    { value: 'wide', label: 'Wide space' },
  ],
} as const

type Choices = typeof EDITOR_CHOICES
export type EditorSettings = { -readonly [K in keyof Choices]: Choices[K][number]['value'] }

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  font: 'serif',
  size: 'medium',
  leading: 'normal',
  paragraphs: 'indent',
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** What was saved, field by field: a value that is no longer a choice falls back to the default. */
function readSettings(saved: Record<string, unknown>): EditorSettings {
  const out = { ...DEFAULT_EDITOR_SETTINGS }
  for (const key of Object.keys(EDITOR_CHOICES) as (keyof EditorSettings)[])
    if (EDITOR_CHOICES[key].some((c) => c.value === saved[key])) (out[key] as unknown) = saved[key]
  return out
}

/** How the text looks, kept per device. The editor reads it as `data-*` attributes (editor.css). */
export const useEditorStore = defineStore('editor', () => {
  const settings = usePersisted<EditorSettings>(
    'editor-settings',
    // A copy: the ref is edited in place, and the defaults must stay what they are.
    { ...DEFAULT_EDITOR_SETTINGS },
    (v): v is EditorSettings => isObject(v),
    (v) => readSettings(v as unknown as Record<string, unknown>),
  )
  const reset = () => (settings.value = { ...DEFAULT_EDITOR_SETTINGS })
  return { settings, reset }
})
