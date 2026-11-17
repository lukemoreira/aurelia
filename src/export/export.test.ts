// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readZip } from '../../tests/helpers/read-zip'
import { PROFILE_BASE, bok, exportFixture, scn } from '../../tests/helpers/export-fixture'
import { assertWellFormed } from '../../tests/helpers/xml-check'
import type { WorkspaceData } from '@/domain/workspace-data'
import { saltmarchSample } from '@/sample/saltmarch'
import { buildExportBook, GONE, NOT_HERE } from './book'
import { exportBook, printBook } from './index'
import { isLanguage, readProfile, type ExportFormat } from './profile'

const profile = (extra: Record<string, unknown> = {}) => readProfile({ ...PROFILE_BASE, ...extra })
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const files = async (format: Exclude<ExportFormat, 'pdf'>, data = exportFixture(), extra = {}) =>
  readZip(await bytes(exportBook(data, bok, profile({ format, ...extra })).blob))
const part = (zip: { path: string; text: string }[], path: string) =>
  zip.find((f) => f.path === path)?.text ?? ''

/** Golden files: `UPDATE_GOLDEN=1 npx vitest run src/export` writes them again. */
function golden(name: string, actual: string) {
  if (!name) throw new Error('A golden file needs a name.')
  const path = join(process.cwd(), 'tests/golden/export', name)
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, actual)
  }
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

describe('the book an export reads', () => {
  it('is in outline order, parts first-chapter marked, unfiled scenes left out', () => {
    const data = exportFixture()
    data.scenes.push({
      meta: {
        title: 'Loose',
        schemaVersion: 1,
        id: scn('loose'),
        chapter: 'chp_gone000000',
        order: 'z',
      },
      body: 'Not in a chapter.',
      words: 4,
      book: bok,
    })
    const book = buildExportBook(data, bok, profile())
    expect(book.chapters.map((c) => [c.title, c.part, c.scenes.map((s) => s.title)])).toEqual([
      ['Arrival', 'Part One', ['The Lantern Gate']],
      ['The Bridge', undefined, ['The Old Bridge', 'The Aqueduct']],
    ])
    expect(book.hasParts).toBe(true)
  })

  it('lists every choice of a scene, with the title of where it leads', () => {
    const book = buildExportBook(exportFixture(), bok, profile())
    expect(book.chapters[0]!.scenes[0]!.choices).toEqual([
      { label: 'Pay the warden’s price', target: 'The Old Bridge', targetId: scn('bridge') },
      { label: 'Climb the aqueduct', target: 'The Aqueduct', targetId: scn('aqueduct') },
      { label: 'Go back', target: GONE },
    ])
  })

  it('shows a link to a record as the record’s name, never its ID', () => {
    // The one `[[Elena]]` left is inside a code fence, which is shown exactly as written.
    const text = JSON.stringify(buildExportBook(exportFixture(), bok, profile())).replace(
      /a <b>fenced<\/b> line \[\[Elena\]\]/g,
      '',
    )
    expect(text).toContain('Elena Vasquez')
    expect(text).not.toMatch(/chr_[a-z0-9]{10}/)
    expect(text).not.toMatch(/"(?:text|markdown)":"[^"]*\[\[/) // a link in the text, not the JSON's own brackets
    expect(text).not.toContain('blk-a1b2c3')
  })
})

describe('repeatable exports', () => {
  const formats = ['markdown', 'docx', 'epub'] as const
  it.each(formats)('%s: the same book and profile give the same bytes', async (format) => {
    const a = await bytes(exportBook(exportFixture(), bok, profile({ format })).blob)
    const b = await bytes(exportBook(exportFixture(), bok, profile({ format })).blob)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('pdf: the print view is the same text twice', () => {
    const a = printBook(exportFixture(), bok, profile({ format: 'pdf' }))
    const b = printBook(exportFixture(), bok, profile({ format: 'pdf' }))
    expect(a).toEqual(b)
  })

  describe('on any machine', () => {
    const zone = process.env.TZ
    afterEach(() => {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    })
    it.each(formats)('%s: the bytes do not depend on the time zone', async (format) => {
      const made: Buffer[] = []
      for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
        process.env.TZ = tz
        made.push(
          Buffer.from(await bytes(exportBook(exportFixture(), bok, profile({ format })).blob)),
        )
      }
      expect(made[1]!.equals(made[0]!)).toBe(true)
      expect(made[2]!.equals(made[0]!)).toBe(true)
    })
  })

  it('a different profile is a different file', async () => {
    const a = await bytes(exportBook(exportFixture(), bok, profile({ format: 'docx' })).blob)
    const b = await bytes(
      exportBook(exportFixture(), bok, profile({ format: 'docx', sceneTitles: true })).blob,
    )
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})

describe('EPUB', () => {
  it('starts with a stored mimetype entry, and every entry is whole', async () => {
    const buf = await bytes(exportBook(exportFixture(), bok, profile({ format: 'epub' })).blob)
    const view = new DataView(buf.buffer)
    // The first local header: stored (method 0), with no extra field, and "mimetype" as its name.
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(8, true)).toBe(0)
    expect(view.getUint16(28, true)).toBe(0)
    expect(new TextDecoder().decode(buf.subarray(30, 38))).toBe('mimetype')
    expect(new TextDecoder().decode(buf.subarray(38, 58))).toBe('application/epub+zip')
    const zip = readZip(buf)
    expect(zip[0]!.path).toBe('mimetype')
    expect(zip.every((f) => f.crcOk)).toBe(true)
  })

  it('lists every file it holds in the manifest, and the spine only names manifest items', async () => {
    const zip = await files('epub')
    const opf = part(zip, 'OEBPS/content.opf')
    const hrefs = [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)]
    for (const [, , href] of hrefs) expect(zip.map((f) => f.path)).toContain(`OEBPS/${href}`)
    const ids = new Set(hrefs.map((h) => h[1]))
    for (const [, ref] of opf.matchAll(/<itemref idref="([^"]+)"/g)) expect(ids).toContain(ref)
    expect(part(zip, 'META-INF/container.xml')).toContain('OEBPS/content.opf')
    expect(opf).toContain('<meta property="dcterms:modified">1980-01-01T00:00:00Z</meta>')
    expect(opf).toContain(`urn:aurelia:${bok}`)
  })

  it('has a contents list with the part and its chapters, and notes as footnote asides', async () => {
    const zip = await files('epub')
    const nav = part(zip, 'OEBPS/nav.xhtml')
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toMatch(/Part One<\/a><ol><li><a href="ch001.xhtml">Arrival<\/a><\/li>/)
    const chapter = part(zip, 'OEBPS/ch001.xhtml')
    expect(chapter).toContain('epub:type="noteref"')
    expect(chapter).toContain('<aside epub:type="footnote"')
    expect(chapter).toContain('The gate was built in year 412.')
  })

  it('has a title page only when the profile asks for one, and an empty book still opens', async () => {
    expect(part(await files('epub'), 'OEBPS/title.xhtml')).toContain('Ada Writer')
    expect(
      part(await files('epub', exportFixture(), { titlePage: false }), 'OEBPS/title.xhtml'),
    ).toBe('')
    const empty = exportFixture()
    empty.chapters = []
    empty.scenes = []
    empty.parts = []
    const zip = await files('epub', empty, { titlePage: false })
    expect(part(zip, 'OEBPS/content.opf')).toContain('<itemref idref="title"/>')
    expect(part(zip, 'OEBPS/nav.xhtml')).toContain('<li><a href="title.xhtml">')
  })

  it('golden: the opf and the first chapter', async () => {
    const zip = await files('epub')
    golden('fixture-epub.opf', part(zip, 'OEBPS/content.opf'))
    golden('fixture-epub-ch001.xhtml', part(zip, 'OEBPS/ch001.xhtml'))
  })
})

describe('DOCX', () => {
  const NAMES = [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/styles.xml',
    'word/numbering.xml',
    'word/footnotes.xml',
    'word/settings.xml',
  ]

  it('holds the parts of a Word document, in a fixed order, each whole', async () => {
    const buf = await bytes(exportBook(exportFixture(), bok, profile({ format: 'docx' })).blob)
    const zip = readZip(buf)
    expect(zip.map((f) => f.path)).toEqual(NAMES)
    expect(zip.every((f) => f.crcOk)).toBe(true)
  })

  it('has content types and relationships that agree with the parts', async () => {
    const zip = await files('docx')
    const paths = zip.map((f) => `/${f.path}`)
    for (const [, name] of part(zip, '[Content_Types].xml').matchAll(/PartName="([^"]+)"/g))
      expect(paths).toContain(name)
    const rels = part(zip, 'word/_rels/document.xml.rels')
    for (const [, target] of rels.matchAll(/Target="([a-z]+\.xml)"/g))
      expect(paths).toContain(`/word/${target}`)
    // Every relationship the document uses is declared, and a link is an external one.
    const doc = part(zip, 'word/document.xml')
    for (const [, id] of doc.matchAll(/r:id="([^"]+)"/g)) expect(rels).toContain(`Id="${id}"`)
    expect(rels).toMatch(/Target="https:\/\/example\.com\/map" TargetMode="External"/)
    // Every footnote the text refers to is in footnotes.xml.
    const notes = part(zip, 'word/footnotes.xml')
    for (const [, id] of doc.matchAll(/footnoteReference w:id="(\d+)"/g))
      expect(notes).toContain(`<w:footnote w:id="${id}">`)
    // Every list the text uses has a numbering definition.
    const numbering = part(zip, 'word/numbering.xml')
    for (const [, id] of doc.matchAll(/w:numId w:val="(\d+)"/g))
      expect(numbering).toContain(`w:numId="${id}"`)
  })

  it('writes headings, emphasis, a table, a note and a checklist the way Word reads them', async () => {
    const doc = part(await files('docx'), 'word/document.xml')
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain('Chapter 1: Arrival')
    expect(doc).toContain('<w:i/></w:rPr><w:t xml:space="preserve">already')
    expect(doc).toContain('<w:b/></w:rPr><w:t xml:space="preserve">Lantern Gate')
    expect(doc).toContain('<w:strike/>')
    expect(doc).toContain('<w:tblHeader/>')
    expect(doc).toContain('<w:jc w:val="right"/>')
    expect(part(await files('docx'), 'word/numbering.xml')).toContain(
      '<w:startOverride w:val="3"/>',
    )
  })

  it('golden: document.xml', async () => {
    golden('fixture-docx-document.xml', part(await files('docx'), 'word/document.xml'))
  })

  it('golden: a book with scene titles, a plain separator and no title page', async () => {
    const zip = await files('docx', exportFixture(), {
      sceneTitles: true,
      titlePage: false,
      separator: 'rule',
      chapterTitles: 'none',
    })
    golden('fixture-docx-scenes-document.xml', part(zip, 'word/document.xml'))
  })

  it('sets the page, the font, the size and the line spacing of the profile', async () => {
    const styles = part(
      await files('docx', exportFixture(), {
        pageSize: 'a4',
        font: 'mono',
        fontSize: 11,
        spacing: 2,
      }),
      'word/styles.xml',
    )
    expect(styles).toContain('w:ascii="Courier New"')
    expect(styles).toContain('<w:sz w:val="22"/>')
    expect(styles).toContain('w:line="480"')
    const doc = part(await files('docx', exportFixture(), { pageSize: 'a4' }), 'word/document.xml')
    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>')
  })
})

describe('Markdown bundle', () => {
  it('has a folder for each part and chapter and a file for each scene, in reading order', async () => {
    const zip = await files('markdown')
    expect(zip.map((f) => f.path)).toEqual([
      'The Lantern Gate/01 Part One/01 Arrival/01 The Lantern Gate.md',
      'The Lantern Gate/01 Part One/02 The Bridge/01 The Old Bridge.md',
      'The Lantern Gate/01 Part One/02 The Bridge/02 The Aqueduct.md',
    ])
    const text = zip[0]!.text
    // The real titles of the book, part and chapter are in the file, not only in the folder names.
    expect(text).toMatch(
      /^---\ntitle: "The Lantern Gate"\nbook: "The Lantern Gate"\npart: "Part One"\nchapter: "Arrival"\n---\n\n/,
    )
    expect(text).toContain('Elena Vasquez reached the **Lantern Gate**')
    expect(text).toContain('a <b>fenced</b> line [[Elena]]') // code is left exactly as it is
    expect(text).not.toContain('^blk-')
  })
})

describe('a branching book shows every choice', () => {
  const LABELS = ['Pay the warden’s price', 'Climb the aqueduct', 'Go back']
  const TARGETS = ['The Old Bridge', 'The Aqueduct', GONE]

  it.each(['markdown', 'docx', 'epub'] as const)(
    '%s: label and target of each choice',
    async (format) => {
      const zip = await files(format)
      const all = zip
        .map((f) => f.text)
        .join('\n')
        .replace(/&#8594;/g, '→')
        .replace(/&amp;/g, '&')
      for (let i = 0; i < LABELS.length; i++) {
        const expected = `${LABELS[i]} → ${TARGETS[i]}`
        expect(
          all.replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1').replace(/<[^>]+>/g, ''),
        ).toContain(expected)
      }
    },
  )

  it('pdf: label and target of each choice, with a link to a scene that is in the book', () => {
    const { html } = printBook(exportFixture(), bok, profile({ format: 'pdf' }))
    for (const label of LABELS) expect(html).toContain(label)
    expect(html).toContain(`<a href="#print-${scn('bridge')}">The Old Bridge</a>`)
    expect(html).toContain(`id="print-${scn('bridge')}"`)
    expect(html).toContain(`Go back &#8594; ${GONE}`)
  })

  it('a scene with no choices has no Choices list', () => {
    const { html } = printBook(exportFixture(), bok, profile({ format: 'pdf' }))
    expect(html.match(/class="choices"/g)).toHaveLength(1)
  })

  it('the reading order is the outline order, not the order of the choices', async () => {
    const data = exportFixture()
    // The scenes of the second chapter swap places: the outline decides.
    data.scenes.find((s) => s.meta.id === scn('bridge'))!.meta.order = 'c'
    const zip = await files('markdown', data)
    expect(zip.map((f) => f.path.split('/').at(-1))).toEqual([
      '01 The Lantern Gate.md',
      '01 The Aqueduct.md',
      '02 The Old Bridge.md',
    ])
  })
})

describe('what is written is only ever text', () => {
  function hostile(): WorkspaceData {
    const data = exportFixture()
    const s = data.scenes[0]!
    s.body =
      'A <script>alert(1)</script> & "quotes" \u0001 [x](javascript:alert(1)) [ok](https://a.b/?q=1&r=2)\n\n<img src=x onerror=alert(1)>\n'
    s.meta.title = 'Title <b>bold</b> & more'
    data.books[0]!.title = 'Book <i>&</i>'
    return data
  }

  it('escapes it in an EPUB and in the print view, and drops an address it cannot follow', async () => {
    const epub = (await files('epub', hostile())).map((f) => f.text).join('\n')
    const print = printBook(hostile(), bok, profile({ format: 'pdf' })).html
    for (const html of [epub, print]) {
      expect(html).not.toContain('<script')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('javascript:')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp;')
      expect(html).toContain('href="https://a.b/?q=1&amp;r=2"')
      expect(html).toContain('Book &lt;i&gt;&amp;&lt;/i&gt;')
    }
  })

  it('writes a control character into no part of a DOCX or an EPUB', async () => {
    for (const format of ['docx', 'epub'] as const)
      for (const f of await files(format, hostile()))
        // eslint-disable-next-line no-control-regex
        expect(f.text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
  })

  it('writes XML every part of which is well formed', async () => {
    for (const format of ['docx', 'epub'] as const)
      for (const f of await files(format, hostile()))
        if (/\.(xml|rels|opf|xhtml)$/.test(f.path))
          expect(() => assertWellFormed(f.text), f.path).not.toThrow()
  })
})

const golden_md = import.meta.glob('../../tests/golden/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('every kind of text the editor knows', () => {
  /** One scene per golden file of the dialect (`tests/golden/`), in one chapter. */
  function corpus(): WorkspaceData {
    const data = exportFixture()
    const [chapter] = data.chapters
    data.scenes = Object.entries(golden_md).map(([path, text], i) => ({
      meta: {
        title: path.split('/golden/')[1]!,
        schemaVersion: 1,
        id: scn(`golden${i}`),
        chapter: chapter!.id,
        order: String.fromCharCode(97 + (i % 26)) + 'a'.repeat(Math.floor(i / 26)),
      },
      body: text,
      words: 1,
      book: bok,
    }))
    data.chapters = [chapter!]
    return data
  }

  it('is a corpus of many files', () => {
    expect(Object.keys(golden_md).length).toBeGreaterThan(12)
  })

  it.each(['docx', 'epub', 'markdown'] as const)(
    '%s: every file exports to well formed parts',
    async (format) => {
      for (const f of await files(format, corpus()))
        if (/\.(xml|rels|opf|xhtml)$/.test(f.path))
          expect(() => assertWellFormed(f.text), f.path).not.toThrow()
    },
  )

  it('the print view holds the words of every file', () => {
    const { html } = printBook(corpus(), bok, profile({ format: 'pdf' }))
    expect(html.length).toBeGreaterThan(5000)
    expect(html).not.toContain('<script')
  })

  it('an empty book, and a book with an empty chapter, export in every format', async () => {
    const empty = exportFixture()
    empty.chapters = []
    empty.scenes = []
    empty.parts = []
    const hollow = exportFixture()
    hollow.scenes = []
    for (const data of [empty, hollow])
      for (const format of ['docx', 'epub', 'markdown'] as const)
        for (const f of await files(format, data))
          if (/\.(xml|rels|opf|xhtml)$/.test(f.path))
            expect(() => assertWellFormed(f.text), f.path).not.toThrow()
    expect(printBook(empty, bok, profile({ format: 'pdf' })).html).toContain('title-page')
  })
})

describe('the sample universe', () => {
  it('exports every one of its books, in every format, with every choice of a branching book', async () => {
    const data = saltmarchSample()
    for (const book of data.books) {
      for (const format of ['docx', 'epub', 'markdown'] as const) {
        const made = exportBook(data, book.id, profile({ format }))
        const zip = readZip(new Uint8Array(await made.blob.arrayBuffer()))
        expect(
          zip.every((f) => f.crcOk),
          `${book.title} ${format}`,
        ).toBe(true)
        for (const f of zip)
          if (/\.(xml|rels|opf|xhtml)$/.test(f.path))
            expect(() => assertWellFormed(f.text), `${book.title} ${f.path}`).not.toThrow()
      }
      const { html } = printBook(data, book.id, profile({ format: 'pdf' }))
      const choices = data.scenes
        .filter((s) => s.book === book.id)
        .flatMap((s) => s.meta.choices ?? [])
      for (const c of choices)
        expect(html, c.label).toContain(
          c.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        )
    }
  })
})

describe('what a reader is told, and what the file is made of', () => {
  const docxOf = async (data: WorkspaceData, extra = {}) =>
    part(await files('docx', data, extra), 'word/document.xml')
  const withBody = (body: string, extra: Record<string, unknown> = {}) => {
    const data = exportFixture()
    data.scenes = [data.scenes[0]!]
    data.parts = []
    data.chapters = [{ ...data.chapters[0]!, part: undefined }]
    data.scenes[0]!.body = body
    data.scenes[0]!.meta.choices = (extra.choices as never) ?? undefined
    return data
  }

  it('says that a choice leads to a scene that is not in this export, not what that scene is called', () => {
    const data = exportFixture()
    const other = scn('elsewhere')
    data.scenes.push({
      meta: {
        title: 'Secret title',
        schemaVersion: 1,
        id: other,
        chapter: 'chp_gone000000',
        order: 'z',
      },
      body: '',
      words: 0,
      book: bok,
    })
    data.scenes[0]!.meta.choices!.push({ id: 'chc_elsewhere1', label: 'Slip away', target: other })
    const choices = buildExportBook(data, bok, profile()).chapters[0]!.scenes[0]!.choices
    expect(choices.at(-1)).toEqual({ label: 'Slip away', target: NOT_HERE })
    expect(JSON.stringify(choices)).not.toContain('Secret title')
  })

  it('a choice to a scene that has no title is "Untitled scene", not "no longer here"', () => {
    const data = exportFixture()
    data.scenes.find((s) => s.meta.id === scn('bridge'))!.meta.title = '   '
    const [first] = buildExportBook(data, bok, profile()).chapters[0]!.scenes[0]!.choices
    expect(first).toMatchObject({ target: 'Untitled scene', targetId: scn('bridge') })
  })

  it('writes only a language tag a reading app can read', async () => {
    expect(readProfile({ id: 'x', language: 'not a language!' }).language).toBe('en')
    expect(readProfile({ id: 'x', language: ' fr-CA ' }).language).toBe('fr-CA')
    const epub = async (language: string) =>
      part(await files('epub', exportFixture(), { language }), 'OEBPS/content.opf')
    const bad = await epub('<x>')
    expect(bad).toContain('<dc:language>en</dc:language>')
    expect(bad).not.toContain('<x>')
    expect(await epub('fr-CA')).toContain('<dc:language>fr-CA</dc:language>')
    // A profile that was not read (the dialog's draft) is held to the same: nothing a reading app cannot read.
    expect(buildExportBook(exportFixture(), bok, { ...profile(), language: '<x>' }).language).toBe(
      'en',
    )
    expect(isLanguage('en-GB')).toBe(true)
    expect(isLanguage('e')).toBe(false)
  })

  it('writes a link address as a URL, and no address it cannot follow', async () => {
    const html = (
      await files('epub', withBody('[é](https://a.b/é) [x](https://a.b/ok) [n](ftp://a.b/x)\n'))
    )
      .map((f) => f.text)
      .join('\n')
    expect(html).toContain('href="https://a.b/%C3%A9"')
    expect(html).toContain('href="https://a.b/ok"')
    expect(html).not.toContain('ftp:')
  })

  it('leaves a comment out of Word, EPUB and PDF, and keeps it in the Markdown bundle', async () => {
    const body = '<!-- block note -->\n\nShe left <!-- inline note --> early.\n'
    const data = withBody(body)
    for (const format of ['docx', 'epub'] as const) {
      const all = (await files(format, data)).map((f) => f.text).join('\n')
      expect(all, format).not.toMatch(/block note|inline note/)
      expect(all, format).toContain('early')
    }
    expect(printBook(data, bok, profile({ format: 'pdf' })).html).not.toMatch(
      /block note|inline note/,
    )
    const md = (await files('markdown', data)).map((f) => f.text).join('\n')
    expect(md).toContain('<!-- block note -->')
    expect(md).toContain('<!-- inline note -->')
  })

  it('leaves code exactly as it is in the Markdown bundle: spans and indented blocks, but not a link in a list', async () => {
    const body = [
      'Say `[[Elena]]` and [[Elena]].',
      '',
      '    [[Elena]] in an indented block',
      '',
      '- item',
      '',
      '    [[Elena]] in a list, not code',
      '',
    ].join('\n')
    const md = (await files('markdown', withBody(body)))[0]!.text
    expect(md).toContain('Say `[[Elena]]` and Elena.')
    expect(md).toContain('    [[Elena]] in an indented block')
    expect(md).toContain('    Elena in a list, not code')
  })

  it('puts the page break of a chapter that starts with a table before the table', async () => {
    const data = withBody('| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter.\n')
    const doc = await docxOf(data, { titlePage: false, chapterTitles: 'none' })
    expect(doc).toContain('<w:body><w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p><w:tbl>')
    expect(doc.match(/pageBreakBefore/g)).toHaveLength(1)
  })

  it('writes keepNext before pageBreakBefore, as the schema orders them', async () => {
    const data = withBody('', {
      choices: [{ id: 'chc_a0000000001', label: 'Go', target: scn('gate') }],
    })
    const doc = await docxOf(data, { titlePage: false, chapterTitles: 'none' })
    expect(doc).toContain('<w:keepNext/><w:pageBreakBefore/>')
  })
})
