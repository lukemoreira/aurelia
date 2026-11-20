// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@tiptap/core'
import { computed, ref, shallowRef } from 'vue'
import { markReading, readingUnits, unitAt } from '@/editor/reading'
import { useEditsStore } from '@/stores/edits'
import { isString, usePersisted } from './usePersisted'

export const RATE_MIN = 0.8
export const RATE_MAX = 1.5
const clampRate = (n: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, n))

const NO_VOICE =
  'No voice on this device, so nothing was read. Read aloud only uses voices that keep your text on this device.'

/** Whether this browser can speak at all. Without it the button and the palette entry are not drawn. */
const canSpeak = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined'

/** The languages to prefer, best first: the browser's. (A book has no language of its own yet.) */
const preferredLanguages = () =>
  typeof navigator === 'undefined'
    ? []
    : [...(navigator.languages ?? []), navigator.language].filter(Boolean)

const tag = (lang: string) => lang.toLowerCase().replace('_', '-')

/**
 * The voice to speak with, always one of `local`: the one chosen, else one for a preferred language
 * (the exact tag, then the same language), else the device's own default.
 */
export function pickVoice(
  local: readonly SpeechSynthesisVoice[],
  chosen: string,
  languages: readonly string[],
): SpeechSynthesisVoice | undefined {
  const same = local.find((v) => v.voiceURI === chosen)
  if (same) return same
  for (const lang of languages) {
    const want = tag(lang)
    const hit =
      local.find((v) => tag(v.lang) === want) ??
      local.find((v) => tag(v.lang).split('-')[0] === want.split('-')[0])
    if (hit) return hit
  }
  return local.find((v) => v.default) ?? local[0]
}

/**
 * Read aloud (the browser's `speechSynthesis`). One paragraph is one utterance, all queued at once. Only
 * voices with `localService` are ever used: a network voice (Chrome's "Google …" ones) would send the text
 * away, and an utterance with no voice set would use the browser's default, which may be one of them.
 */
export function createReadAloud() {
  const available = canSpeak()
  const voice = usePersisted('read-aloud-voice', 'auto', isString)
  const rate = usePersisted(
    'read-aloud-rate',
    1,
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
    clampRate,
  )
  /** The voices that keep the text on this device. They can arrive late, so this follows `voiceschanged`. */
  const voices = shallowRef<SpeechSynthesisVoice[]>([])
  const refresh = () =>
    (voices.value = window.speechSynthesis.getVoices().filter((v) => v.localService))
  if (available) {
    refresh()
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
  }

  const status = ref<'idle' | 'reading' | 'paused'>('idle')
  /** The editor being read, and the scene's editor the palette and the shortcut act on. */
  const current = shallowRef<Editor | null>(null)
  const attached = shallowRef<Editor | null>(null)
  let token = 0
  let release: (() => void) | null = null
  // Held so a browser cannot collect an utterance before it has ended.
  let queued: SpeechSynthesisUtterance[] = []

  function stop() {
    if (status.value === 'idle') return
    token++
    release?.()
    release = null
    queued = []
    const editor = current.value
    current.value = null
    status.value = 'idle'
    window.speechSynthesis.cancel()
    // A browser that was paused stays paused after a cancel: the next reading would be silent.
    window.speechSynthesis.resume()
    if (editor && !editor.isDestroyed) markReading(editor.view, null)
  }

  /** From the paragraph with the caret (or the selection's start) to the end of the scene. */
  function start(editor: Editor | null = attached.value) {
    if (!available || !editor || editor.isDestroyed) return
    stop()
    refresh() // voices may not have announced themselves yet
    const toast = (text: string) => (useEditsStore().toast = { text, error: true })
    const chosen = pickVoice(voices.value, voice.value, preferredLanguages())
    if (!chosen) return toast(NO_VOICE)
    const units = readingUnits(editor.state.doc)
    const first = unitAt(units, editor.state.selection.from)
    if (first < 0) return toast('There is nothing to read from here.')

    const session = ++token
    const live = () => session === token
    const rest = units.slice(first)
    queued = rest.map((unit, i) => {
      const u = new SpeechSynthesisUtterance(unit.text)
      u.voice = chosen
      u.lang = chosen.lang
      u.rate = rate.value
      u.onstart = () => live() && markReading(editor.view, unit)
      u.onend = () => live() && i === rest.length - 1 && stop()
      // Stopping cancels the queue, which the browser reports as an error: not a failure.
      u.onerror = (e) => live() && e.error !== 'interrupted' && e.error !== 'canceled' && stop()
      return u
    })

    // Typing (any change of the text), leaving the scene, Esc and closing the page all stop it.
    const onChange = ({ transaction }: { transaction: { docChanged: boolean } }) =>
      transaction.docChanged && stop()
    // Esc that closes the palette, a dialog or a menu is theirs, not ours. ProseMirror marks every Esc typed in
    // the text as handled, so in the text `defaultPrevented` says nothing.
    const onKey = (e: KeyboardEvent) => {
      const inText = e.target instanceof Element && !!e.target.closest('[contenteditable]')
      const handled = e.defaultPrevented && !inText
      if (
        e.key === 'Escape' &&
        !handled &&
        !document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
      )
        stop()
    }
    editor.on('transaction', onChange)
    editor.on('destroy', stop)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pagehide', stop)
    release = () => {
      editor.off('transaction', onChange)
      editor.off('destroy', stop)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pagehide', stop)
    }

    current.value = editor
    status.value = 'reading'
    markReading(editor.view, rest[0]!)
    window.speechSynthesis.resume()
    for (const u of queued) window.speechSynthesis.speak(u)
  }

  function pause() {
    if (status.value !== 'reading') return
    window.speechSynthesis.pause()
    status.value = 'paused'
  }
  function resume() {
    if (status.value !== 'paused') return
    window.speechSynthesis.resume()
    status.value = 'reading'
  }
  const toggle = (editor?: Editor) => (status.value === 'idle' ? start(editor) : stop())

  return {
    available,
    voices,
    voice,
    rate,
    status,
    current,
    /** A scene is on screen to read: the palette entry is offered. */
    canRead: computed(() => !!attached.value),
    start,
    stop,
    pause,
    resume,
    toggle,
    attach: (editor: Editor) => (attached.value = editor),
    detach(editor: Editor) {
      if (attached.value === editor) attached.value = null
      if (current.value === editor) stop()
    },
  }
}

let shared: ReturnType<typeof createReadAloud> | undefined
/** The one reader: the toolbar, the palette, the shortcut and the settings all share it. */
export const useReadAloud = () => (shared ??= createReadAloud())
