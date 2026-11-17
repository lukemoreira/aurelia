// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { exportFixture, bok, PROFILE_BASE } from '../../tests/helpers/export-fixture'
import { makeZip } from '../../tests/helpers/make-zip'
import { exportBook } from '@/export'
import { readProfile } from '@/export/profile'
import { ImportError, MAX_FILE_BYTES, MAX_FILES } from './limits'
import { naturalCompare } from './markdown'
import { planFiles, planIds, planStats, report, type ImportPlan, type ReportItem } from './plan'
import { parseLinks } from './twine'
import { planFromFiles, type SourceFile } from './sources'

const enc = (s: string) => new TextEncoder().encode(s)
const file = (path: string, data: string | Uint8Array): SourceFile => {
  const bytes = (typeof data === 'string' ? enc(data) : data) as Uint8Array<ArrayBuffer>
  return { path, size: bytes.length, read: async () => bytes }
}
const unreadOf = (
  plan: { report: { unread: { text: string; names: string[] }[] } },
  text: RegExp,
) => plan.report.unread.find((i) => text.test(i.text))
const noteOf = (plan: { report: { notes: { text: string; names: string[] }[] } }, text: RegExp) =>
  plan.report.notes.find((i) => text.test(i.text))

describe('natural order', () => {
  it('puts 2 before 10, and a file before the folders next to it', () => {
    const sorted = ['10 b.md', 'a/2.md', '2 a.md', 'a/10.md'].sort(naturalCompare)
    expect(sorted).toEqual(['2 a.md', '10 b.md', 'a/2.md', 'a/10.md'])
  })
})

describe('Markdown files', () => {
  it('makes a chapter of each folder and a scene of each file, in natural order', async () => {
    const plan = await planFromFiles(
      [
        file('Part 10/a.md', 'ten'),
        file('Part 2/b.md', 'two b'),
        file('Part 2/a.md', 'two a'),
        file('Prologue.md', 'first'),
      ],
      'My book',
    )
    expect(plan.mode).toBe('linear')
    expect(plan.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ['Chapter 1', ['Prologue']],
      ['Part 2', ['A', 'B']],
      ['Part 10', ['A']],
    ])
    expect(planStats(plan)).toMatchObject({ chapters: 3, scenes: 4 })
  })

  it('takes a title from the file’s details, else its first heading (which is not repeated), else its name', async () => {
    const plan = await planFromFiles(
      [
        file('1.md', '---\ntitle: From details\n---\n\n# Ignored heading\n\nText one.'),
        file('2.md', '# The heading\n\nText two.\n'),
        file('03-the-name.md', 'No heading here.'),
      ],
      'B',
    )
    const scenes = plan.chapters[0]!.scenes
    expect(scenes.map((s) => s.title)).toEqual(['From details', 'The heading', 'The name'])
    expect(scenes[0]!.body).toBe('# Ignored heading\n\nText one.\n')
    expect(scenes[1]!.body).toBe('Text two.\n')
  })

  it('reads a file with Windows line endings and a byte order mark as plain text', async () => {
    const plan = await planFromFiles([file('a.md', '﻿# Title\r\n\r\nOne.\r\nTwo.\r\n')], 'B')
    expect(plan.chapters[0]!.scenes[0]).toMatchObject({ title: 'Title', body: 'One.\nTwo.\n' })
  })

  it('names the details of a file that are not kept, and keeps what it cannot read as text', async () => {
    const plan = await planFromFiles(
      [
        file('a.md', '---\ntitle: A\ndate: 2020-01-01\ntags: [x]\n---\n\nBody'),
        file('b.md', '---\ntitle: [unclosed\n---\n\nBody'),
      ],
      'B',
    )
    expect(plan.report.notes.map((n) => [n.text, n.names])).toEqual(
      expect.arrayContaining([
        ['Only the title is kept from the details at the top: date, tags', ['a.md']],
      ]),
    )
    expect(noteOf(plan, /could not be read, so they are kept/)?.names).toEqual(['b.md'])
    expect(plan.chapters[0]!.scenes[1]!.body).toContain('title: [unclosed')
  })

  it('lists every file it could not read, with the reason, and still imports the rest', async () => {
    const plan = await planFromFiles(
      [
        file('a.md', 'Fine.'),
        file('cover.png', new Uint8Array([137, 80, 78, 71])),
        file('notes/map.jpg', new Uint8Array([1])),
        file('bad.md', new Uint8Array([0xff, 0xfe, 0x41])),
        { path: 'huge.md', size: MAX_FILE_BYTES + 1, read: async () => new Uint8Array() },
        file('.DS_Store', 'x'),
        file('__MACOSX/._a.md', 'x'),
        file('.git/config', 'x'),
      ],
      'B',
    )
    expect(planStats(plan).scenes).toBe(1)
    expect(unreadOf(plan, /Not a Markdown or text file/)?.names).toEqual([
      'cover.png',
      'notes/map.jpg',
    ])
    expect(unreadOf(plan, /Not UTF-8 text/)?.names).toEqual(['bad.md'])
    expect(unreadOf(plan, /Larger than 5 MB/)?.names).toEqual(['huge.md'])
    expect(unreadOf(plan, /Hidden files/)?.names).toEqual(['.git'])
    // A file the operating system adds is not worth a line.
    expect(JSON.stringify(plan.report)).not.toMatch(/DS_Store|MACOSX/)
  })

  it('says so, in plain words, when nothing can be read', async () => {
    await expect(planFromFiles([file('a.png', 'x')], 'B')).rejects.toThrow(/found no writing/)
    await expect(planFromFiles([], 'B')).rejects.toThrow(/Choose some files/)
  })

  it('refuses more files, or more bytes, than it reads at once, before reading any', async () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`${i}.md`, 'x'))
    await expect(planFromFiles(many, 'B')).rejects.toThrow(/more than 2000 files/)
    const heavy = [
      { path: 'a.md', size: 30 * 1024 * 1024, read: async () => new Uint8Array() },
      { path: 'b.md', size: 30 * 1024 * 1024, read: async () => new Uint8Array() },
    ]
    await expect(planFromFiles(heavy, 'B')).rejects.toBeInstanceOf(ImportError)
    await expect(planFromFiles(heavy, 'B')).rejects.toThrow(/more than 50 MB/)
  })
})

describe('a zip from another tool', () => {
  it('reads deflated and stored entries, takes the shared folder off and names the book after it', async () => {
    const zip = makeZip([
      { path: 'My Novel/', data: '', method: 'store' },
      { path: 'My Novel/01 Start/a.md', data: '# One\n\nHello ' + 'word '.repeat(500) },
      { path: 'My Novel/01 Start/b.md', data: 'Stored.', method: 'store' },
    ])
    const plan = await planFromFiles([file('My Novel.zip', zip)], 'My Novel (zip)')
    expect(plan.title).toBe('My Novel')
    expect(plan.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ['Start', ['One', 'B']],
    ])
    expect(plan.chapters[0]!.scenes[0]!.body.startsWith('Hello word word')).toBe(true)
  })

  it('names the entries it cannot read and goes on: a password, a name that climbs out, damage', async () => {
    const zip = makeZip([
      { path: 'a.md', data: 'Fine.' },
      { path: 'secret.md', data: 'x', encrypted: true },
      { path: '../escape.md', data: 'x' },
      { path: 'broken.md', data: 'some words to deflate '.repeat(20), damage: true },
    ])
    const plan = await planFromFiles([file('b.zip', zip)], 'B')
    expect(planStats(plan).scenes).toBe(1)
    expect(unreadOf(plan, /password protected/)?.names).toEqual(['secret.md'])
    expect(unreadOf(plan, /leads outside/)?.names).toEqual(['../escape.md'])
    expect(unreadOf(plan, /damaged/)?.names).toEqual(['broken.md'])
  })

  it('stops a zip that inflates to more than it says it holds', async () => {
    const bomb = 'a'.repeat(MAX_FILE_BYTES + 1000)
    const zip = makeZip([
      { path: 'ok.md', data: 'Fine.' },
      { path: 'bomb.md', data: bomb, claimSize: 100 },
    ])
    const plan = await planFromFiles([file('b.zip', zip)], 'B')
    expect(planStats(plan).scenes).toBe(1)
    expect(unreadOf(plan, /larger than 5 MB|damaged/)?.names).toEqual(['bomb.md'])
  })

  it('refuses a zip that says it holds more than it may, and one that is not a zip', async () => {
    const zip = makeZip([{ path: 'a.md', data: 'x', claimSize: 60 * 1024 * 1024 }])
    await expect(planFromFiles([file('b.zip', zip)], 'B')).rejects.toThrow(/more than 50 MB/)
    const plan = await planFromFiles([file('a.md', 'Fine.'), file('c.zip', enc('not a zip'))], 'B')
    expect(unreadOf(plan, /not a zip/)?.names).toEqual(['c.zip'])
  })
})

describe('a Twee story', () => {
  const TWEE = `:: StoryTitle
The Lantern Gate

:: StoryData
{ "ifid": "X", "format": "Harlowe", "start": "Arrival" }

:: Arrival [intro warm] {"position":"100,100"}
The bells rang. Do you [[go in->Gate]] or [[Stay outside]]?

* [[Aqueduct<-Climb]]
* [[Ask the warden|Warden]]
[[Nowhere to be found]]

:: Gate
You go in. (set: $brave to true) (if: $brave)[Bold.]
[[Back->Arrival][$tried to 1]]

:: Stay outside
Rain. Nothing else.

:: Aqueduct
Wind.

:: Warden
"Curfew," he says.

:: StoryInit
(set: $gold to 0)

:: Odd\\[name\\] [x]
Escaped name.
`

  it('makes the passages the scenes of a branching book, with the start from StoryData', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE)], 'gate')
    expect(plan).toMatchObject({ source: 'twine', mode: 'branching', title: 'The Lantern Gate' })
    const scenes = plan.chapters[0]!.scenes
    expect(scenes.map((s) => s.title)).toEqual([
      'Arrival',
      'Gate',
      'Stay outside',
      'Aqueduct',
      'Warden',
      'Odd[name]',
    ])
    const byKey = new Map(scenes.map((s) => [s.key, s.title]))
    expect(byKey.get(plan.start!)).toBe('Arrival')
  })

  it('turns every kind of link into a choice, and every choice leads to a scene of the book', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE)], 'gate')
    const scenes = plan.chapters[0]!.scenes
    const title = (key: string) => scenes.find((s) => s.key === key)!.title
    const arrival = scenes[0]!
    expect(arrival.choices.map((c) => [c.label, title(c.target)])).toEqual([
      ['go in', 'Gate'],
      ['Stay outside', 'Stay outside'],
      ['Climb', 'Aqueduct'],
      ['Ask the warden', 'Warden'],
    ])
    // The setter is not part of the link.
    expect(scenes[1]!.choices.map((c) => [c.label, title(c.target)])).toEqual([['Back', 'Arrival']])
    for (const s of scenes)
      for (const c of s.choices) expect(scenes.some((x) => x.key === c.target)).toBe(true)
  })

  it('keeps the words around a link: lines of links are the choices, a link in a sentence is its label', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE)], 'gate')
    const body = plan.chapters[0]!.scenes[0]!.body
    expect(body).toContain('The bells rang. Do you go in or Stay outside?')
    expect(body).not.toContain('Climb')
    expect(body).not.toContain('Ask the warden')
    // A link to a passage that is not there stays as its words, and is named.
    expect(body).toContain('Nowhere to be found')
    expect(noteOf(plan, /not in the story/)?.names).toEqual(['Arrival: Nowhere to be found'])
  })

  it('leaves macros and variables as text and names them', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE)], 'gate')
    expect(plan.chapters[0]!.scenes[1]!.body).toContain('(set: $brave to true) (if: $brave)[Bold.]')
    const note = noteOf(plan, /Macros and variables stay as text/)!
    expect(note.text).toContain('(set:)')
    expect(note.text).toContain('$brave')
    expect(note.names).toEqual(['Gate'])
    expect(noteOf(plan, /sets a variable/)?.names).toEqual(['Gate'])
  })

  it('names what it did not make scenes of, and marks a passage with no links as an ending', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE)], 'gate')
    expect(unreadOf(plan, /code or settings/)?.names).toEqual(['StoryInit'])
    expect(noteOf(plan, /tags are not kept/)?.text).toMatch(/intro, warm, x/)
    const scenes = plan.chapters[0]!.scenes
    expect(scenes.filter((s) => s.ending).map((s) => s.title)).toEqual([
      'Stay outside',
      'Aqueduct',
      'Warden',
      'Odd[name]',
    ])
  })

  it('starts at the passage called Start when the story names none, else at the first', async () => {
    const a = await planFromFiles([file('a.twee', ':: One\nx\n\n:: Start\ny\n')], 'a')
    expect(a.chapters[0]!.scenes.find((s) => s.key === a.start)!.title).toBe('Start')
    const b = await planFromFiles([file('b.twee', ':: One\nx\n\n:: Two\ny\n')], 'b')
    expect(b.chapters[0]!.scenes.find((s) => s.key === b.start)!.title).toBe('One')
  })

  it('says so when there is no passage to make a scene of', async () => {
    await expect(planFromFiles([file('e.twee', ':: StoryTitle\nX\n')], 'e')).rejects.toThrow(
      /no passages/,
    )
  })

  it('imports a Twine story on its own, and says that the other files were left out', async () => {
    const plan = await planFromFiles([file('gate.twee', TWEE), file('notes.md', 'x')], 'gate')
    expect(unreadOf(plan, /imported on its own/)?.names).toEqual(['notes.md'])
  })
})

describe('Twine 2 published HTML', () => {
  const HTML = `<!DOCTYPE html><html><head><title>t</title><style>body{}</style></head><body>
<tw-storydata name="Published" startnode="2" creator="Twine" creator-version="2.6.2" ifid="X" format="SugarCube" format-version="2.36" options="" hidden>
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">.x{}</style>
<script role="script" id="twine-user-script" type="text/twine-javascript">alert("not run")</script>
<tw-tag name="warm" color="red"></tw-tag>
<tw-passagedata pid="1" name="Elsewhere" tags="warm" position="1,1" size="100,100">The end &amp; &lt;b&gt;more&lt;/b&gt;.</tw-passagedata>
<tw-passagedata pid="2" name="Begin" tags="" position="2,2" size="100,100">Go &lt;&lt;if $x&gt;&gt;[[there-&gt;Elsewhere]]&lt;&lt;/if&gt;&gt; &lt;script&gt;alert(1)&lt;/script&gt;</tw-passagedata>
</tw-storydata>
<tw-storydata name="Second" startnode="1"><tw-passagedata pid="1" name="X">y</tw-passagedata></tw-storydata>
</body></html>`

  it('reads the passages as data: entities decoded, the start from startnode, nothing run or inserted', async () => {
    const before = document.body.innerHTML
    const plan = await planFromFiles([file('story.html', HTML)], 'story')
    expect(document.body.innerHTML).toBe(before)
    expect(plan).toMatchObject({ source: 'twine', title: 'Published' })
    const scenes = plan.chapters[0]!.scenes
    expect(scenes.map((s) => s.title)).toEqual(['Elsewhere', 'Begin'])
    expect(scenes[0]!.body).toBe('The end & <b>more</b>.\n')
    expect(scenes[1]!.body).toContain('<script>alert(1)</script>') // kept as the words it is
    expect(plan.chapters[0]!.scenes.find((s) => s.key === plan.start)!.title).toBe('Begin')
    expect(scenes[1]!.choices).toHaveLength(1)
    expect(noteOf(plan, /Macros and variables/)?.text).toContain('<<if>>')
    expect(unreadOf(plan, /first story of a Twine archive/)?.names).toEqual(['Second'])
  })

  it('does not take an ordinary web page for a story', async () => {
    const plan = await planFromFiles(
      [file('page.html', '<html><body>hi</body></html>'), file('a.md', 'Fine.')],
      'b',
    )
    expect(plan.source).toBe('markdown')
    expect(unreadOf(plan, /not a published Twine story/)?.names).toEqual(['page.html'])
    expect(JSON.stringify(plan.report)).not.toMatch(/Not a Markdown or text file/)
  })
})

describe('Twine link syntax', () => {
  const read = (text: string) => parseLinks(text).map((l) => [l.label, l.target])
  it('reads each form the way Twine does', () => {
    expect(read('[[Go on]]')).toEqual([['Go on', 'Go on']])
    expect(read('[[Go->Gate]]')).toEqual([['Go', 'Gate']])
    expect(read('[[Gate<-Go]]')).toEqual([['Go', 'Gate']])
    expect(read('[[Go|Gate]]')).toEqual([['Go', 'Gate']])
  })
  it('takes the rightmost -> and the leftmost <-, and a | before either', () => {
    expect(read('[[Go->on->Gate]]')).toEqual([['Go->on', 'Gate']])
    expect(read('[[A<-B<-C]]')).toEqual([['B<-C', 'A']])
    expect(read('[[a->b|c]]')).toEqual([['a->b', 'c']])
  })
  it('leaves a setter out of the link and says it was there', () => {
    const [link] = parseLinks('[[go|there][$x to 1]]')
    expect(link).toMatchObject({ label: 'go', target: 'there', setter: true })
  })
  it('finds every link of a text, with where it stands', () => {
    const text = 'a [[One]] b [[Two->Three]]'
    expect(parseLinks(text).map((l) => text.slice(l.start, l.end))).toEqual([
      '[[One]]',
      '[[Two->Three]]',
    ])
  })
})

describe('the files of a plan', () => {
  it('never writes a choice whose scene is not in the plan', () => {
    const plan: ImportPlan = {
      source: 'twine',
      title: 'T',
      mode: 'branching',
      chapters: [
        {
          title: 'P',
          scenes: [
            {
              key: 'a',
              title: 'A',
              body: '',
              choices: [
                { label: 'x', target: 'missing' },
                { label: 'y', target: 'a' },
              ],
            },
          ],
        },
      ],
      report: { unread: [], notes: [] },
    }
    let n = 0
    const ids = planIds(
      plan,
      'unv_aaaaaaaaaa',
      (prefix) => `${prefix}_${String(++n).padStart(10, '0')}`,
    )
    const scene = planFiles(plan, ids).find((f) => f.path.includes('/scenes/'))!
    expect(scene.text).toContain('label: "y"')
    expect(scene.text).not.toContain('label: "x"')
  })
})

describe('Aurelia’s own Markdown bundle', () => {
  it('is read back: chapters, scenes, titles and words, with the choices left as the list they were', async () => {
    const made = exportBook(
      exportFixture(),
      bok,
      readProfile({ ...PROFILE_BASE, format: 'markdown' }),
    )
    const bytes = new Uint8Array(await made.blob.arrayBuffer())
    const plan = await planFromFiles([file('The Lantern Gate (Markdown).zip', bytes)], 'x')
    expect(plan.title).toBe('The Lantern Gate')
    expect(plan.report.unread).toEqual([])
    expect(plan.chapters.map((c) => [c.title, c.scenes.map((s) => s.title)])).toEqual([
      ['Arrival', ['The Lantern Gate']],
      ['The Bridge', ['The Old Bridge', 'The Aqueduct']],
    ])
    const gate = plan.chapters[0]!.scenes[0]!
    expect(gate.body).toContain('Elena Vasquez reached the **Lantern Gate**')
    expect(gate.body).toContain('- Climb the aqueduct → The Aqueduct')
    expect(plan.chapters[1]!.scenes[0]!.body).toBe(
      'The bridge was *shorter* than she remembered.\n\nShe crossed it anyway.\n',
    )
  })
})

describe('what is not the details at the top', () => {
  it('keeps the whole text of a file that opens with a scene break', async () => {
    const plan = await planFromFiles(
      [
        file('a.md', '---\n\nShe woke at dawn.\n\n---\n\nThe rest.\n'),
        file('b.md', '---\n- one\n---\nAfter.'),
      ],
      'B',
    )
    const [a, b] = plan.chapters[0]!.scenes
    expect(a!.body).toBe('---\n\nShe woke at dawn.\n\n---\n\nThe rest.\n')
    expect(b!.body).toBe('---\n- one\n---\nAfter.\n')
    expect(plan.report.notes).toEqual([])
  })

  it('does not cut a long first heading: it stays in the text and the title is the file’s name', async () => {
    const long = 'Word '.repeat(60).trim()
    const plan = await planFromFiles([file('03-the-name.md', `# ${long}\n\nBody.\n`)], 'B')
    const scene = plan.chapters[0]!.scenes[0]!
    expect(scene.title).toBe('The name')
    expect(scene.body).toBe(`# ${long}\n\nBody.\n`)
  })

  it('takes the chapter’s title from the files that say it, and does not count it as a detail lost', async () => {
    const plan = await planFromFiles(
      [
        file(
          '01 A-slug/01 x.md',
          '---\ntitle: X\nbook: B\nchapter: "The Real: Title"\npart: P\n---\n\nText.',
        ),
      ],
      'B',
    )
    expect(plan.chapters[0]!.title).toBe('The Real: Title')
    expect(plan.report.notes.map((n) => n.text)).toEqual([
      'Only the title is kept from the details at the top: part',
    ])
  })
})

describe('what counts toward the limits', () => {
  it('counts only what would be read: not hidden folders, operating system files or images', async () => {
    const many = [
      ...Array.from({ length: MAX_FILES + 50 }, (_, i) => file(`.hidden/obj${i}`, 'x')),
      ...Array.from({ length: MAX_FILES + 50 }, (_, i) => file(`img/${i}.png`, 'x')),
      { path: 'big.png', size: 90 * 1024 * 1024, read: async () => new Uint8Array() },
      file('a.md', 'Fine.'),
    ]
    const plan = await planFromFiles(many, 'B')
    expect(planStats(plan).scenes).toBe(1)
    expect(unreadOf(plan, /Hidden files/)?.names).toEqual(['.hidden'])
    expect(unreadOf(plan, /Not a Markdown or text file/)?.names).toHaveLength(MAX_FILES + 51)
  })

  it('counts a zip the same way: images and hidden entries in it are free', async () => {
    const zip = makeZip([
      { path: 'a.md', data: 'Fine.' },
      { path: 'huge.png', data: 'x', claimSize: 80 * 1024 * 1024 },
      ...Array.from({ length: MAX_FILES + 10 }, (_, i) => ({
        path: `.git/o${i}`,
        data: 'x',
        method: 'store' as const,
      })),
    ])
    const plan = await planFromFiles([file('b.zip', zip)], 'B')
    expect(planStats(plan).scenes).toBe(1)
  })

  it('takes off the folder a zip shares even when macOS added its own entries beside it', async () => {
    const zip = makeZip([
      { path: 'Book/a.md', data: 'Fine.' },
      { path: '__MACOSX/Book/._a.md', data: 'x' },
      { path: '.DS_Store', data: 'x' },
    ])
    const plan = await planFromFiles([file('b.zip', zip)], 'other')
    expect(plan.title).toBe('Book')
    expect(JSON.stringify(plan.report)).not.toMatch(/MACOSX|DS_Store/)
  })

  it('says an entry is damaged when its place in the zip is wrong, not that it is not UTF-8', async () => {
    const zip = makeZip([
      { path: 'a.md', data: 'Fine.', method: 'store' },
      { path: 'b.md', data: 'Also.', method: 'store' },
    ])
    const view = new DataView(zip.buffer)
    let at = view.getUint32(zip.length - 22 + 16, true)
    at += 46 + 4 // the second entry's header
    view.setUint32(at + 42, 0x7fffff00, true)
    const plan = await planFromFiles([file('b.zip', zip)], 'B')
    expect(unreadOf(plan, /damaged/)?.names).toEqual(['b.md'])
    expect(JSON.stringify(plan.report)).not.toContain('UTF-8')
  })
})

describe('the report', () => {
  it('takes twenty thousand names without slowing down, and never lists a name twice', () => {
    const list: ReportItem[] = []
    const start = performance.now()
    for (let i = 0; i < 20000; i++) report(list, 'Broken link', `p${i % 15000}`)
    expect(performance.now() - start).toBeLessThan(500)
    expect(list).toHaveLength(1)
    expect(list[0]!.names).toHaveLength(15000)
  })
})
