// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { PROFILE_BASE, bok, exportFixture, unv } from '../../tests/helpers/export-fixture'
import { readZip } from '../../tests/helpers/read-zip'
import { assertWellFormed } from '../../tests/helpers/xml-check'
import { sampleId } from '@/sample/ids'
import type { WorkspaceData } from '@/domain/workspace-data'
import { readCover, type ExportCover } from './cover'
import { exportBook, printBook } from './index'
import { readProfile } from './profile'

const MED = sampleId('med', 'cover')
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]) as Uint8Array<ArrayBuffer>
const profile = (format: 'epub' | 'pdf' | 'docx') => readProfile({ ...PROFILE_BASE, format })
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const part = (zip: { path: string; text: string }[], path: string) =>
  zip.find((f) => f.path === path)?.text ?? ''

/** The fixture with a cover chosen from the gallery, as `book.json` and a media sidecar say it. */
function withCover(file = `${MED}.png`): WorkspaceData {
  const data = exportFixture()
  data.books[0]!.cover = MED
  data.media = [{ meta: { schemaVersion: 1, id: MED, file }, universe: unv }]
  return data
}
const read = (data: WorkspaceData, file = new Map([[`universes/${unv}/media/${MED}.png`, PNG]])) =>
  readCover(data, bok, async (path) => file.get(path) ?? null)

describe('reading the cover of a book', () => {
  it('is the image book.json names, with the kind its extension says', async () => {
    expect(await read(withCover())).toEqual({ ext: 'png', type: 'image/png', bytes: PNG })
  })
  it('is nothing when no cover is set, the image was deleted, its file is gone or cannot be read', async () => {
    expect(await read(exportFixture())).toBeUndefined()
    const deleted = withCover()
    deleted.media = [] // it waits in Recently deleted
    expect(await read(deleted)).toBeUndefined()
    expect(await read(withCover(), new Map())).toBeUndefined()
    expect(
      await readCover(withCover(), bok, async () => {
        throw new Error('disk')
      }),
    ).toBeUndefined()
    expect(await read(withCover('med_x.exe'))).toBeUndefined()
  })
})

describe('the cover in an EPUB', () => {
  const cover: ExportCover = { ext: 'png', type: 'image/png', bytes: PNG }
  const zipOf = async (c?: ExportCover) =>
    readZip(await bytes(exportBook(exportFixture(), bok, profile('epub'), c).blob))

  it('is a manifest item, the EPUB 2 meta, a first page in the spine and the image file itself', async () => {
    const zip = await zipOf(cover)
    const opf = part(zip, 'OEBPS/content.opf')
    expect(opf).toContain(
      '<item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>',
    )
    expect(opf).toContain('<meta name="cover" content="cover-image"/>')
    expect(opf).toContain(
      '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    )
    expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])[0]).toBe('cover')
    expect(opf.indexOf('idref="cover"')).toBeLessThan(opf.indexOf('idref="title"'))
    const page = part(zip, 'OEBPS/cover.xhtml')
    expect(page).toContain('epub:type="cover"')
    expect(page).toContain('src="cover.png"')
    assertWellFormed(page)
    assertWellFormed(opf)
    const image = zip.find((f) => f.path === 'OEBPS/cover.png')!
    expect(image.crcOk).toBe(true)
    // The zip is stored, so the file's bytes are in the archive as they were read.
    const raw = await bytes(exportBook(exportFixture(), bok, profile('epub'), cover).blob)
    expect(Buffer.from(raw).includes(Buffer.from(PNG))).toBe(true)
    expect(zip[0]!.path).toBe('mimetype')
  })

  it('keeps an SVG cover as an SVG, and leaves an AVIF (no EPUB image type) out', async () => {
    const svg = { ext: 'svg', type: 'image/svg+xml', bytes: PNG }
    expect(part(await zipOf(svg), 'OEBPS/content.opf')).toContain(
      'href="cover.svg" media-type="image/svg+xml" properties="cover-image"',
    )
    const avif = await zipOf({ ext: 'avif', type: 'image/avif', bytes: PNG })
    expect(avif.map((f) => f.path)).not.toContain('OEBPS/cover.avif')
    expect(part(avif, 'OEBPS/content.opf')).not.toContain('cover')
    const webp = await zipOf({ ext: 'webp', type: 'image/webp', bytes: PNG })
    expect(webp.map((f) => f.path)).toContain('OEBPS/cover.webp')
  })

  it('leaves out an SVG cover that loads anything from outside the book', async () => {
    const svg = (text: string) => ({
      ext: 'svg',
      type: 'image/svg+xml',
      bytes: new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>,
    })
    for (const outside of [
      '<svg><image href="https://example.com/a.png"/></svg>',
      "<svg><image xlink:href='//example.com/a.png'/></svg>",
      '<svg><style>rect { fill: url( "http://example.com/p.svg#g" ) }</style></svg>',
    ]) {
      const zip = await zipOf(svg(outside))
      expect(zip.map((f) => f.path)).not.toContain('OEBPS/cover.svg')
      expect(part(zip, 'OEBPS/content.opf')).not.toContain('cover')
    }
    const inside = await zipOf(svg('<svg><use href="#a"/><rect fill="url(#g)"/></svg>'))
    expect(inside.map((f) => f.path)).toContain('OEBPS/cover.svg')
  })

  it('without a cover is byte for byte the EPUB there was', async () => {
    const without = await bytes(exportBook(exportFixture(), bok, profile('epub')).blob)
    const none = await bytes(exportBook(exportFixture(), bok, profile('epub'), undefined).blob)
    expect(Buffer.from(none).equals(Buffer.from(without))).toBe(true)
    expect(part(readZip(without), 'OEBPS/content.opf')).not.toContain('cover')
  })

  it('a missing or deleted cover image exports without a cover, and does not throw', async () => {
    const missing = withCover()
    missing.media = []
    const found = await readCover(missing, bok, async () => PNG)
    expect(found).toBeUndefined()
    const a = await bytes(exportBook(missing, bok, profile('epub'), found).blob)
    const b = await bytes(exportBook(exportFixture(), bok, profile('epub')).blob)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('an empty book with a cover still opens, the cover first', async () => {
    const empty = exportFixture()
    empty.chapters = []
    empty.scenes = []
    empty.parts = []
    const zip = readZip(await bytes(exportBook(empty, bok, profile('epub'), cover).blob))
    const spine = [...part(zip, 'OEBPS/content.opf').matchAll(/<itemref idref="([^"]+)"/g)]
    expect(spine.map((m) => m[1])).toEqual(['cover', 'title'])
  })
})

describe('the cover in the print view', () => {
  const cover: ExportCover = { ext: 'png', type: 'image/png', bytes: PNG }
  it('is the first page, before the title page', () => {
    const view = printBook(exportFixture(), bok, profile('pdf'), cover)
    expect(
      view.html.startsWith('<section class="cover-page"><img src="data:image/png;base64,'),
    ).toBe(true)
    expect(view.html.indexOf('cover-page')).toBeLessThan(view.html.indexOf('title-page'))
    expect(view.html).toContain('alt="Cover of The Lantern Gate"')
    expect(view.css).toContain('.cover-page { break-after: page')
  })
  it('without a cover is the view there was', () => {
    const plain = printBook(exportFixture(), bok, profile('pdf'))
    expect(plain.html).not.toContain('cover-page')
    expect(plain.css).not.toContain('cover-page')
    expect(printBook(exportFixture(), bok, profile('pdf'), undefined)).toEqual(plain)
  })

  describe('page numbers', () => {
    const css = (extra: Record<string, unknown>, c?: ExportCover) =>
      printBook(exportFixture(), bok, readProfile({ ...PROFILE_BASE, format: 'pdf', ...extra }), c)
        .css
    const NUMBERING =
      '@page { size: letter; margin: 2.2cm 2.4cm 2.6cm; @bottom-center { content: counter(page); font-size: 10pt; } }\n@page :first { @bottom-center { content: none; } }'

    it.each([true, false])(
      'without a cover (title page %s) the numbering is the one there was: the first page unnumbered, no counter reset',
      (titlePage) => {
        const plain = css({ titlePage })
        expect(plain).toContain(NUMBERING)
        expect(plain.startsWith('@page {')).toBe(true) // nothing is put before the page rules
        expect(plain).not.toMatch(/counter-set|page: (cover|front|body)|@page (cover|front)/)
      },
    )

    it('with a cover: the cover does not count, and page 1 after it (title page or first chapter) shows no number', () => {
      for (const titlePage of [true, false]) {
        const sheet = css({ titlePage }, cover)
        expect(sheet).toContain(
          '.print-book .cover-page { break-after: page; text-align: center; page: cover; }',
        )
        // Page rules only: Chrome ignores a page counter set on an element, and `:first` on a later page.
        expect(sheet).toContain(
          '@page cover { counter-increment: page 0; @bottom-center { content: none; } }',
        )
        expect(sheet).toContain(
          '@counter-style print-from-two { system: extends decimal; range: 2 infinite; fallback: print-unnumbered; }',
        )
        expect(sheet).toContain('@bottom-center { content: counter(page, print-from-two);')
        expect(sheet).not.toMatch(/counter-set|front:first|page: (front|body)/)
      }
    })
  })
})
