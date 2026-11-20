// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A fake `speechSynthesis` for tests, in the unit tests and (sent to the page as text) in the browser
 * ones. It must stay self-contained: no imports and no names from outside, or Playwright cannot send it.
 * It speaks nothing: the test says when each utterance ends (`finish`).
 */
export function installFakeSpeech(win: any, given?: any[]) {
  const queue: any[] = []
  let speaking: any = null
  const listeners: Record<string, ((e: unknown) => void)[]> = {}
  const fake: any = {
    /** Every utterance handed to `speak`, in order. */
    spoken: [] as any[],
    paused: false,
    cancels: 0,
    voices: given ?? [
      {
        name: 'Local Voice',
        lang: 'en-US',
        voiceURI: 'local-en',
        localService: true,
        default: true,
      },
      {
        name: 'Local Français',
        lang: 'fr-CA',
        voiceURI: 'local-fr',
        localService: true,
        default: false,
      },
      {
        name: 'Google US English',
        lang: 'en-US',
        voiceURI: 'google-en',
        localService: false,
        default: false,
      },
    ],
    texts: () => fake.spoken.map((u: any) => u.text),
    /** The utterance being spoken now. */
    current: () => speaking,
    /** It ended by itself: the next one starts. */
    finish() {
      const u = speaking
      speaking = null
      u?.onend?.({})
      if (!speaking) {
        speaking = queue.shift() ?? null
        speaking?.onstart?.({})
      }
    },
    /** Voices arrived late. */
    setVoices(list: any[]) {
      fake.voices = list
      for (const fn of listeners.voiceschanged ?? []) fn({})
    },
  }
  class FakeUtterance {
    text: string
    voice: any = null
    lang = ''
    rate = 1
    onstart: any = null
    onend: any = null
    onerror: any = null
    constructor(text: string) {
      this.text = text
    }
  }
  const synth = {
    speak(u: any) {
      fake.spoken.push(u)
      if (speaking) queue.push(u)
      else {
        speaking = u
        u.onstart?.({})
      }
    },
    cancel() {
      const u = speaking
      queue.length = 0
      speaking = null
      fake.cancels++
      u?.onerror?.({ error: 'interrupted' })
    },
    pause: () => (fake.paused = true),
    resume: () => (fake.paused = false),
    getVoices: () => fake.voices,
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ??= []).push(fn),
    removeEventListener: (type: string, fn: (e: unknown) => void) =>
      (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
  }
  Object.defineProperty(win, 'speechSynthesis', { value: synth, configurable: true })
  Object.defineProperty(win, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
  })
  win.__fakeSpeech = fake
  return fake
}

/** Take the fake away again (a browser without speech). */
export function removeFakeSpeech(win: any) {
  delete win.speechSynthesis
  delete win.SpeechSynthesisUtterance
  delete win.__fakeSpeech
}
