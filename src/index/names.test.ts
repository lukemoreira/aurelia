// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { parseLinks } from './links'
import {
  buildMatcher,
  findNames,
  ignoreKey,
  isWholeAt,
  shortForms,
  skipZones,
  withoutIgnored,
  type NameForm,
} from './names'

const forms = (...f: [string, string, NameForm['mode']?][]): NameForm[] =>
  f.map(([recordId, text, mode]) => ({ recordId, text, mode: mode ?? 'auto' }))
const find = (text: string, f: NameForm[]) => {
  const links = parseLinks(text)
  return findNames(text, buildMatcher(f), skipZones(text, links))
}
const words = (text: string, f: NameForm[]) =>
  find(text, f).map((m) => [m.text, m.status, m.reason ?? ''])

const ELENA = forms(['elena', 'Elena Vasquez'], ['elena', 'Elena'], ['elena', 'Lena'])

describe('finding names', () => {
  it('finds whole words, with the possessive, and the longest name first', () => {
    expect(words("Elena Vasquez met Elena’s brother. Elena's too.", ELENA)).toEqual([
      ['Elena Vasquez', 'tagged', ''],
      ['Elena', 'tagged', ''],
      ['Elena', 'tagged', ''],
    ])
  })

  it('never takes a word out of a longer word, or an address (Elena is not Elenath or elena@example.com)', () => {
    expect(find('Elenath and Elenas and elena@example.com and Elena@example.com', ELENA)).toEqual(
      [],
    )
    expect(find('write to elena@example.com or see https://example.com/Elena', ELENA)).toEqual([])
    expect(find('Marie-Elena and Elena-Marie and Elena.Marie', ELENA)).toEqual([])
    expect(find('Elena-- Elena. Elena, “Elena!”', ELENA)).toHaveLength(4)
  })

  it('is a whole word only: each side of the word is looked at on its own', () => {
    const whole = (text: string, at: string) =>
      isWholeAt(text, text.indexOf(at), text.indexOf(at) + at.length)
    expect(whole('say Elena now', 'Elena')).toBe(true)
    expect(whole('Elenath', 'Elena')).toBe(false) // a letter after
    expect(whole('xElena', 'Elena')).toBe(false) // a letter before
    expect(whole('Elena2', 'Elena')).toBe(false) // a digit after
    expect(whole('_Elena_', 'Elena')).toBe(true) // italics
    expect(whole('Elenã', 'Elena')).toBe(false) // an accent is part of the word
    expect(whole('me@Elena', 'Elena')).toBe(false) // an address before
    expect(whole('Elena@me', 'Elena')).toBe(false) // an address after
    expect(whole('Elena.Marsh', 'Elena')).toBe(false) // a dotted name after
    expect(whole('Marie-Elena', 'Elena')).toBe(false) // a hyphenated name before
    expect(whole('Elena. Then', 'Elena')).toBe(true) // a full stop is not
    expect(whole('Elena’s', 'Elena')).toBe(true) // a possessive is not
  })

  it('falls back to the shorter name when the longer one is only part of a longer word', () => {
    expect(words('Elena Vasquezs left.', ELENA)).toEqual([['Elena', 'tagged', '']])
  })

  it('keeps the author’s capitals: "will" is never "Will"', () => {
    const will = forms(['will', 'Will'])
    expect(words('She will go. Will you? He said Will had it.', will)).toEqual([
      ['Will', 'suggest', 'sentence-start'],
      ['Will', 'tagged', ''],
    ])
  })

  it('asks about a name that begins a sentence only when it is also a common word', () => {
    expect(words('Elena ran.', ELENA)).toEqual([['Elena', 'tagged', '']])
    expect(words('“Will you give it back?” she said.', forms(['w', 'Will']))).toEqual([
      ['Will', 'suggest', 'sentence-start'],
    ])
  })

  it('asks which one when two records share a name, and for an alias set to ask', () => {
    const f = forms(['boy', 'Corin'], ['river', 'Corin'], ['will', 'Ashby', 'ask'])
    const found = find('Corin swam. Ashby waved.', f)
    expect(found.map((m) => [m.status, m.reason, m.recordIds])).toEqual([
      ['suggest', 'shared', ['boy', 'river']],
      ['suggest', 'ask', ['will']],
    ])
  })

  it('ignores an alias set to never, and lets the other owner of a shared name win', () => {
    expect(find('Lena left.', forms(['a', 'Lena', 'never']))).toEqual([])
    const shared = find('Corin swam.', forms(['boy', 'Corin'], ['river', 'Corin', 'never']))
    expect(shared.map((m) => [m.status, m.recordIds])).toEqual([['tagged', ['boy']]])
  })

  it('looks inside no link and no code: the link decides', () => {
    const text = 'See [[Elena Vasquez|Elena]] and `Elena` and Elena.'
    const found = find(text, ELENA)
    expect(found.map((m) => m.start)).toEqual([text.lastIndexOf('Elena')])
  })

  it('finds a name made of several words, a name inside quotes, and none in an empty scope', () => {
    const gate = forms(['gate', 'the Lantern Gate'], ['gate', 'Lantern Gate'])
    expect(words('Past the Lantern Gate they ran to the Lantern Gate.', gate)).toEqual([
      ['the Lantern Gate', 'tagged', ''],
      ['the Lantern Gate', 'tagged', ''],
    ])
    expect(find('Elena', [])).toEqual([])
  })
})

describe('the author’s "not a name" answers', () => {
  const text = 'Will ran. Will you stop? And Will stopped.\n\nA new day. Will came back.\n'
  const will = forms(['w', 'Will'])

  it('keys an answer by the nth time the word stands in the scene', () => {
    const found = find(text, will)
    expect(found.map((m) => ignoreKey(text, m))).toEqual(['Will:1', 'Will:2', 'Will:3', 'Will:4'])
  })

  it('drops only the answered one', () => {
    const found = find(text, will)
    const left = withoutIgnored(text, found, new Set(['Will:2']))
    expect(left.map((m) => m.start)).toEqual([found[0]!.start, found[2]!.start, found[3]!.start])
  })

  it('numbers the same places whatever marks the word is written in', () => {
    const t = 'Will ran. _Will_ hid. **Will** and `Will` and Will\\_ and [[x|Will]].'
    const keys = find(t, will).map((m) => ignoreKey(t, m))
    expect(keys).toEqual(['Will:1', 'Will:2', 'Will:3', 'Will:5'])
  })

  it('hides only a question: a real name that now carries the number stays', () => {
    const t = 'Will you stop? She said Will knew.'
    const found = find(t, will)
    expect(found.map((m) => m.status)).toEqual(['suggest', 'tagged'])
    // The first "Will" was answered once; words added before it since moved its number onto the second.
    const left = withoutIgnored(t, found, new Set(['Will:2']))
    expect(left).toEqual(found)
  })

  it('finds a name in italics, with a combining accent, and not in an address or a link target', () => {
    const e = forms(['e', 'Elena'], ['m', 'José'])
    expect(find('_Elena_ ran, *Elena* hid.', e).map((m) => m.text)).toEqual(['Elena', 'Elena'])
    expect(
      find('Jose\u0301 spoke. Jose\u0301 left.', forms(['m', 'Jose'])).map((m) => m.text),
    ).toEqual([])
    expect(
      find('See file:///home/Elena/notes and [a](https://x.y/Elena) and [b](../Elena).', e),
    ).toEqual([])
  })

  it('counts a place already turned into a link, so accepting one never moves another answer', () => {
    const before = 'Will ran. Will hid.'
    const after = '[[id:chr_x|Will]] ran. Will hid.'
    const key = (t: string, i: number) => {
      const found = find(t, will)
      return ignoreKey(t, found[i]!)
    }
    expect(key(before, 1)).toBe('Will:2')
    expect(key(after, 0)).toBe('Will:2')
  })
})

describe('a character’s short forms, from its title', () => {
  it('takes the nickname in quotes, the first name and the last name', () => {
    expect(shortForms('“Archie” Archibald Collins')).toEqual(['Archie', 'Archibald', 'Collins'])
    expect(shortForms('Thomas "Tommy" Kent')).toEqual(['Tommy', 'Thomas', 'Kent'])
    expect(shortForms('Professor Reginald Baines')).toEqual(['Reginald', 'Baines'])
    expect(shortForms('Major Dempsey')).toEqual(['Dempsey'])
    expect(shortForms('Corporal Jeremy Todd')).toEqual(['Jeremy', 'Todd'])
  })

  it('reads straight, curly and single quotes around a whole word, never an apostrophe', () => {
    expect(shortForms('Thomas “Tommy” Kent')).toEqual(['Tommy', 'Thomas', 'Kent'])
    expect(shortForms("Thomas 'Tommy' Kent")).toEqual(['Tommy', 'Thomas', 'Kent'])
    expect(shortForms('Thomas ‘Tommy’ Kent')).toEqual(['Tommy', 'Thomas', 'Kent'])
    expect(shortForms("Patrick O'Brien")).toEqual(['Patrick', "O'Brien"])
  })

  it('never gives a rank, a particle, an initial, a suffix, or anything after “of”', () => {
    expect(shortForms('Dr. Mary Shaw')).toEqual(['Mary', 'Shaw'])
    expect(shortForms('Captain Sir John Moore Jr.')).toEqual(['John', 'Moore'])
    expect(shortForms('Ludwig van Beethoven')).toEqual(['Ludwig', 'Beethoven'])
    expect(shortForms('J. R. Hartley III')).toEqual(['Hartley'])
    expect(shortForms('Arthur of Camelot')).toEqual(['Arthur'])
    expect(shortForms('Queen Mab')).toEqual(['Mab'])
    expect(shortForms('Major')).toEqual([])
  })

  it('strips a rank only at the front and a suffix only at the end: a surname that is a rank gives no last name', () => {
    expect(shortForms('Martin Luther King Jr.')).toEqual(['Martin'])
    expect(shortForms('Edward Bishop')).toEqual(['Edward'])
    expect(shortForms('Grandma Rose Hill')).toEqual(['Rose', 'Hill'])
    expect(shortForms('Ser Duncan Tall')).toEqual(['Duncan', 'Tall'])
    expect(shortForms('DCI Jane Tennison')).toEqual(['Jane', 'Tennison'])
  })

  it('gives nothing extra for a one-word title', () => {
    expect(shortForms('Corin')).toEqual([])
    expect(shortForms('Élodie')).toEqual([])
  })

  it('is found as a whole word, with the possessive', () => {
    const f = shortForms('“Archie” Archibald Collins').map((text): NameForm => ({
      recordId: 'a',
      text,
      mode: 'auto',
    }))
    expect(words('Archie’s coat. Archibald waited; Collinses did not.', f)).toEqual([
      ['Archie', 'tagged', ''],
      ['Archibald', 'tagged', ''],
    ])
  })
})
