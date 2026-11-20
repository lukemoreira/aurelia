// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editorExtensions } from '@/editor/extensions'
import { bodyToDoc, docToBody } from '@/editor/markdown/body'
import { useEditsStore } from '@/stores/edits'
import { installFakeSpeech, removeFakeSpeech } from '../../tests/helpers/fake-speech'
import { createReadAloud, pickVoice } from './useReadAloud'

const BODY = 'One.\n\nTwo with [[id:chr_01HX|Elena]].\n\nThree.\n'
let editor: Editor | undefined
let speech: ReturnType<typeof installFakeSpeech>
beforeEach(() => {
  setActivePinia(createPinia())
  speech = installFakeSpeech(window)
})
afterEach(() => {
  editor?.destroy()
  editor = undefined
  removeFakeSpeech(window)
  localStorage.clear()
})

const start = (body = BODY) =>
  (editor = new Editor({ extensions: editorExtensions, content: bodyToDoc(body) }))
const caretIn = (ed: Editor, needle: string) => {
  let found = -1
  ed.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + 1
  })
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, found)))
}
const marked = (ed: Editor) => ed.view.dom.querySelector('.reading-now')?.textContent ?? null
const toast = () => useEditsStore().toast?.text

describe('reading', () => {
  it('queues one utterance per paragraph, from the caret to the end, and marks the one spoken', () => {
    const ed = start()
    caretIn(ed, 'Two')
    const reader = createReadAloud()
    reader.start(ed)
    expect(speech.texts()).toEqual(['Two with Elena.', 'Three.'])
    expect(reader.status.value).toBe('reading')
    expect(marked(ed)).toBe('Two with [[id:chr_01HX|Elena]].')
    speech.finish()
    expect(marked(ed)).toBe('Three.')
    speech.finish()
    // The last one ended: the mark goes and the reader is free again.
    expect(reader.status.value).toBe('idle')
    expect(marked(ed)).toBeNull()
  })

  it('starts at the beginning when the caret is in the first paragraph', () => {
    const ed = start()
    createReadAloud().start(ed)
    expect(speech.texts()).toEqual(['One.', 'Two with Elena.', 'Three.'])
  })

  it('starts at the selection', () => {
    const ed = start()
    const doc = ed.state.doc
    let from = 0
    doc.descendants((n, pos) => {
      if (n.isText && n.text === 'Three.') from = pos
    })
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(doc, from, from + 3)))
    createReadAloud().start(ed)
    expect(speech.texts()).toEqual(['Three.'])
  })

  it('says so when there is nothing to read from the caret', () => {
    const ed = start('One.\n\n* * *\n')
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)))
    const reader = createReadAloud()
    reader.start(ed)
    expect(speech.texts()).toEqual([])
    expect(reader.status.value).toBe('idle')
    expect(toast()).toMatch(/nothing to read/)
  })

  it('speaks at the chosen speed, never outside 0.8 to 1.5', () => {
    localStorage.setItem('aurelia.v1.read-aloud-rate', '3')
    const reader = createReadAloud()
    expect(reader.rate.value).toBe(1.5)
    reader.start(start())
    expect(speech.spoken.map((u: { rate: number }) => u.rate)).toEqual([1.5, 1.5, 1.5])
  })
})

describe('local voices only', () => {
  it('lists and uses only voices that keep the text on the device', () => {
    const reader = createReadAloud()
    expect(reader.voices.value.map((v) => v.name)).toEqual(['Local Voice', 'Local Français'])
    reader.start(start())
    expect(
      speech.spoken.every((u: { voice: { localService: boolean } }) => u.voice.localService),
    ).toBe(true)
    expect(speech.spoken[0].lang).toBe('en-US')
  })

  it('never uses a network voice, even when one was saved as the choice', () => {
    localStorage.setItem('aurelia.v1.read-aloud-voice', JSON.stringify('google-en'))
    const reader = createReadAloud()
    reader.start(start())
    expect(speech.spoken[0].voice.voiceURI).toBe('local-en')
  })

  it('uses the voice that was chosen', () => {
    localStorage.setItem('aurelia.v1.read-aloud-voice', JSON.stringify('local-fr'))
    createReadAloud().start(start())
    expect(speech.spoken[0].voice.voiceURI).toBe('local-fr')
  })

  it('says plainly there is no local voice, and reads nothing', () => {
    speech.setVoices([
      { name: 'Google US English', lang: 'en-US', voiceURI: 'google-en', localService: false },
    ])
    const reader = createReadAloud()
    reader.start(start())
    expect(speech.spoken).toEqual([])
    expect(reader.status.value).toBe('idle')
    expect(toast()).toMatch(/^No voice on this device/)
  })

  it('takes voices that load late', () => {
    speech.setVoices([])
    const reader = createReadAloud()
    expect(reader.voices.value).toEqual([])
    speech.setVoices([{ name: 'Late', lang: 'en-GB', voiceURI: 'late', localService: true }])
    expect(reader.voices.value.map((v) => v.name)).toEqual(['Late'])
    reader.start(start())
    expect(speech.spoken[0].voice.name).toBe('Late')
  })

  it('picks a voice for the preferred language: the exact tag, then the language, then the default', () => {
    const local = speech.voices.filter((v: { localService: boolean }) => v.localService)
    expect(pickVoice(local, 'auto', ['fr-CA'])?.voiceURI).toBe('local-fr')
    expect(pickVoice(local, 'auto', ['fr-FR'])?.voiceURI).toBe('local-fr')
    expect(pickVoice(local, 'auto', ['de', 'en-GB'])?.voiceURI).toBe('local-en')
    expect(pickVoice(local, 'auto', ['de'])?.voiceURI).toBe('local-en')
    expect(pickVoice([], 'auto', ['en'])).toBeUndefined()
  })
})

describe('control', () => {
  it('pauses, resumes and stops', () => {
    const ed = start()
    const reader = createReadAloud()
    reader.start(ed)
    reader.pause()
    expect(speech.paused).toBe(true)
    expect(reader.status.value).toBe('paused')
    reader.resume()
    expect(speech.paused).toBe(false)
    expect(reader.status.value).toBe('reading')
    reader.stop()
    expect(reader.status.value).toBe('idle')
    expect(speech.cancels).toBe(1)
    expect(marked(ed)).toBeNull()
    // The cancelled queue is not a failure and a later ending does nothing.
    expect(reader.current.value).toBeNull()
  })

  it('toggles: the shortcut and the palette start it and stop it', () => {
    const ed = start()
    const reader = createReadAloud()
    reader.attach(ed)
    expect(reader.canRead.value).toBe(true)
    reader.toggle()
    expect(reader.status.value).toBe('reading')
    reader.toggle()
    expect(reader.status.value).toBe('idle')
  })

  it('stops on Esc, also while paused', () => {
    const reader = createReadAloud()
    reader.start(start())
    reader.pause()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(reader.status.value).toBe('idle')
  })

  it('stops when the author types, and not before', () => {
    const ed = start()
    const reader = createReadAloud()
    reader.start(ed)
    // Moving the caret is not typing.
    caretIn(ed, 'Three')
    expect(reader.status.value).toBe('reading')
    ed.view.dispatch(ed.state.tr.insertText('x', ed.state.selection.from))
    expect(reader.status.value).toBe('idle')
    expect(speech.cancels).toBe(1)
    expect(marked(ed)).toBeNull()
  })

  it('stops when the scene is left (its editor goes away, or it is detached)', () => {
    const ed = start()
    const reader = createReadAloud()
    reader.attach(ed)
    reader.start(ed)
    reader.detach(ed)
    expect(reader.status.value).toBe('idle')
    expect(reader.canRead.value).toBe(false)
    reader.start(ed)
    ed.destroy()
    expect(reader.status.value).toBe('idle')
    expect(speech.cancels).toBe(2)
  })

  it('starting again reads from the new caret, not on top of the old queue', () => {
    const ed = start()
    const reader = createReadAloud()
    reader.start(ed)
    caretIn(ed, 'Three')
    reader.start(ed)
    expect(speech.current().text).toBe('Three.')
    speech.finish()
    expect(reader.status.value).toBe('idle')
  })
})

describe('the text', () => {
  it('is never changed by reading, and reading is never an edit', () => {
    const ed = start()
    const before = JSON.stringify(ed.getJSON())
    const written = docToBody(ed.state.doc)
    const docChanges: boolean[] = []
    ed.on('transaction', ({ transaction }) => docChanges.push(transaction.docChanged))
    let updates = 0
    ed.on('update', () => updates++)
    const reader = createReadAloud()
    reader.start(ed)
    reader.pause()
    reader.resume()
    speech.finish()
    reader.stop()
    expect(JSON.stringify(ed.getJSON())).toBe(before)
    expect(docToBody(ed.state.doc)).toBe(written)
    expect(docChanges.every((changed) => !changed)).toBe(true)
    expect(updates).toBe(0)
  })
})

describe('a browser that cannot speak', () => {
  it('is unavailable, and starting does nothing', () => {
    removeFakeSpeech(window)
    const reader = createReadAloud()
    expect(reader.available).toBe(false)
    reader.start(start())
    expect(reader.status.value).toBe('idle')
  })
})
