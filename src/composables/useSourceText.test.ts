// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useSourceText, type SourceTextOptions } from './useSourceText'

function start(initial: string, options: SourceTextOptions = {}) {
  const body = ref(initial)
  const edits: string[] = []
  const source = useSourceText(
    () => body.value,
    (text) => edits.push(text),
    options,
  )
  return { body, edits, ...source }
}

describe('the Markdown source of a scene', () => {
  it('shows the text as it is and sends nothing until something is typed', async () => {
    const { text, edits, body } = start('One\n\n| a |\n|-|\n')
    expect(text.value).toBe('One\n\n| a |\n|-|\n')
    body.value = 'Changed elsewhere\n'
    await nextTick()
    expect(edits).toEqual([])
  })

  it('sends exactly what is typed, odd spacing and tabs included', () => {
    const { input, edits, text } = start('x')
    input('a  b\t\n\n\n   c ')
    expect(edits).toEqual(['a  b\t\n\n\n   c '])
    expect(text.value).toBe('a  b\t\n\n\n   c ')
  })

  it('gives a file whose lines all end in CRLF its CRLF back', () => {
    const { input, edits, text } = start('a\r\nb\r\n')
    expect(text.value).toBe('a\nb\n')
    input('a\nb\nc\n')
    expect(edits).toEqual(['a\r\nb\r\nc\r\n'])
  })

  it('does not turn a file with plain line ends, or a mix of the two, into CRLF', () => {
    const plain = start('a\nb\n')
    plain.input('a\nb\nc')
    expect(plain.edits).toEqual(['a\nb\nc'])
    const mixed = start('a\r\nb\nc\r\n')
    mixed.input('a\nb\nc\nd')
    expect(mixed.edits).toEqual(['a\nb\nc\nd'])
  })

  it('keeps what was typed on screen while the workspace has not taken it, and follows it once it has', async () => {
    const { input, text, body } = start('one')
    input('one two')
    body.value = 'something else, from another device'
    await nextTick()
    // Ours stays: the workspace has not answered with what was typed.
    expect(text.value).toBe('one two')
    body.value = 'one two'
    await nextTick()
    body.value = 'a later change from outside'
    await nextTick()
    expect(text.value).toBe('a later change from outside')
  })

  it('does not wait for an answer that will never come when the text is typed back to what it was', async () => {
    const { input, text, body } = start('one')
    input('one!')
    body.value = 'one!'
    await nextTick()
    input('one!')
    body.value = 'from outside'
    await nextTick()
    expect(text.value).toBe('from outside')
  })

  it('follows the line endings of a text that changed outside', async () => {
    const { body, input, edits } = start('a\nb\n')
    body.value = 'one\r\ntwo\r\n'
    await nextTick()
    input('one\ntwo\nthree\n')
    expect(edits).toEqual(['one\r\ntwo\r\nthree\r\n'])
    body.value = edits.at(-1)! // the workspace took it
    await nextTick()
    body.value = 'plain\n'
    await nextTick()
    input('plain\nagain\n')
    expect(edits.at(-1)).toBe('plain\nagain\n')
  })

  it('sends again what the workspace refused, once it can take it', async () => {
    const can = ref(false)
    const { input, edits, body } = start('one', { editable: () => can.value })
    input('one two')
    expect(edits).toEqual(['one two'])
    body.value = 'changed under it'
    await nextTick()
    can.value = true
    await nextTick()
    expect(edits).toEqual(['one two', 'one two'])
    body.value = 'one two'
    await nextTick()
    can.value = false
    await nextTick()
    can.value = true
    await nextTick()
    expect(edits).toHaveLength(2)
  })

  it('shows words handed over from the editor, and sends them if they were not taken', () => {
    const taken = start('old', { held: 'old plus words' })
    expect(taken.text.value).toBe('old plus words')
    expect(taken.edits).toEqual(['old plus words'])
    expect(taken.pending()).toBe('old plus words')
    const same = start('same', { held: 'same' })
    expect(same.edits).toEqual([])
    const waiting = start('old', { held: 'new', editable: () => false })
    expect(waiting.edits).toEqual([])
    expect(waiting.text.value).toBe('new')
  })
})
