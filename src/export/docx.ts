// SPDX-License-Identifier: AGPL-3.0-or-later
// A book as a Word document (OOXML), written by hand on the stored zip writer (ADR-0014). Headings,
// paragraphs, emphasis, quotes, lists, tables, footnotes (real Word footnotes), scene breaks. The same book
// and profile give the same bytes: nothing here reads a clock, a random number or the machine's zone.
import { encode } from '@/storage/hash'
import { FIXED_ZIP_STAMP, zipFiles, type ZipFile } from '@/storage/zip'
import type { Block, Inline } from './blocks'
import { chapterHeading, levelsOf, type ExportBook, type ExportScene } from './book'
import { esc } from './html'
import { validLanguage, type ExportProfile } from './profile'

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const FONTS = { serif: 'Times New Roman', sans: 'Arial', mono: 'Courier New' }
/** Page sizes in twentieths of a point: US Letter and A4. */
const PAGES = { letter: [12240, 15840], a4: [11906, 16838] } as const
const TEXT_WIDTH = 9360

interface Style {
  /** The paragraph style (Quote, ListParagraph…); none is Normal. */
  style?: string
  /** Left indent, in twentieths of a point. */
  indent?: number
}

class Writer {
  readonly links = new Map<string, string>()
  readonly footnotes: string[] = []
  /** The first number of each ordered list, by the `numId` it uses (the lists after the bullets). */
  readonly orderedStarts: number[] = []
  /** The next paragraph starts a page (a chapter, a part). */
  pageBreak = false
  /** The notes of the scene being written, by their number in it. */
  notes = new Map<number, Block[]>()
  /** Words for the first paragraph of a footnote: its own number. */
  private lead = ''
  /** Links cannot be written in a footnote (its rels are a part of its own): there they are words. */
  private inNote = false

  constructor(private readonly profile: ExportProfile) {}

  private run(r: Inline, bold = false): string {
    if (r.t === 'br') return '<w:r><w:br/></w:r>'
    if (r.t === 'note') {
      const body = this.notes.get(r.n)
      if (!body || this.inNote) return ''
      const id = this.footnotes.length + 1
      this.footnotes.push('')
      this.inNote = true
      this.footnotes[id - 1] = this.footnote(id, body)
      this.inNote = false
      return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`
    }
    const linked = !!r.href && !this.inNote
    const style = linked ? 'Hyperlink' : r.code ? 'CodeChar' : ''
    const props = [
      style ? `<w:rStyle w:val="${style}"/>` : '',
      r.b || bold ? '<w:b/>' : '',
      r.i ? '<w:i/>' : '',
      r.s ? '<w:strike/>' : '',
      r.u ? '<w:u w:val="single"/>' : '',
    ].join('')
    const text = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`
    return linked
      ? `<w:hyperlink r:id="${this.rel(r.href!)}" w:history="1">${text}</w:hyperlink>`
      : text
  }

  private rel(href: string): string {
    if (!this.links.has(href)) this.links.set(href, `rIdLink${this.links.size + 1}`)
    return this.links.get(href)!
  }

  private runs(c: Inline[], bold = false) {
    return c.map((r) => this.run(r, bold)).join('')
  }

  para(
    inner: string,
    o: {
      style?: string
      jc?: string
      num?: string
      ind?: string
      extra?: string
      keep?: boolean
    } = {},
  ) {
    const props = [
      o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
      o.keep ? '<w:keepNext/>' : '',
      this.pageBreak ? '<w:pageBreakBefore/>' : '',
      o.num ?? '',
      o.extra ?? '',
      o.ind ?? '',
      o.jc ? `<w:jc w:val="${o.jc}"/>` : '',
    ].join('')
    this.pageBreak = false
    const lead = this.lead
    this.lead = ''
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${lead}${inner}</w:p>`
  }

  private footnote(id: number, body: Block[]): string {
    const saved = this.pageBreak
    this.pageBreak = false
    this.lead =
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
    const paragraphs = this.blocks(body, { style: 'FootnoteText' }, 0)
    const text = this.lead ? this.para('', { style: 'FootnoteText' }) + paragraphs : paragraphs
    this.lead = ''
    this.pageBreak = saved
    return `<w:footnote w:id="${id}">${text}</w:footnote>`
  }

  separator(): string {
    const sep = this.profile.separator
    if (sep === 'stars') return this.para('<w:r><w:t>* * *</w:t></w:r>', { style: 'Separator' })
    if (sep === 'space') return this.para('', { style: 'Separator' })
    return this.para('', {
      style: 'Separator',
      extra: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>',
      ind: '<w:ind w:left="3000" w:right="3000"/>',
    })
  }

  blocks(list: Block[], st: Style, depth: number, headOffset = 0): string {
    return list.map((b) => this.block(b, st, depth, headOffset)).join('')
  }

  private block(b: Block, st: Style, depth: number, headOffset: number): string {
    switch (b.t) {
      case 'p':
        return this.para(this.runs(b.c), {
          ...(st.style ? { style: st.style } : {}),
          ...(st.indent ? { ind: `<w:ind w:left="${st.indent}"/>` } : {}),
        })
      case 'h':
        return this.para(this.runs(b.c), {
          style: `Heading${Math.min(6, headOffset + b.level)}`,
        })
      case 'break':
        return this.separator()
      case 'quote':
        return this.blocks(b.c, { style: 'Quote' }, depth + 1, headOffset)
      case 'code':
        return this.para(
          `<w:r>${b.text
            .split('\n')
            .map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(l)}</w:t>`)
            .join('')}</w:r>`,
          { style: 'Code' },
        )
      case 'list':
        return this.list(b, depth, headOffset)
      case 'table':
        return this.table(b)
    }
  }

  private list(b: Extract<Block, { t: 'list' }>, depth: number, headOffset: number): string {
    let numId = 1
    if (b.ordered) {
      this.orderedStarts.push(b.start)
      numId = this.orderedStarts.length + 1
    }
    const level = Math.min(depth, 8)
    return b.items
      .map((item) => {
        let first = true
        return item.c
          .map((child) => {
            const wasFirst = first
            first = false
            if (child.t === 'list') return this.list(child, depth + 1, headOffset)
            if (child.t !== 'p')
              return this.block(child, { indent: 720 * (level + 1) }, depth + 1, headOffset)
            const box =
              wasFirst && item.checked !== undefined
                ? `<w:r><w:t xml:space="preserve">${item.checked ? '\u2611' : '\u2610'} </w:t></w:r>`
                : ''
            const text = box + this.runs(child.c)
            // A checklist item has no bullet of its own: its box is its marker.
            if (wasFirst && item.checked === undefined)
              return this.para(text, {
                style: 'ListParagraph',
                num: `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
              })
            return this.para(text, {
              style: 'ListParagraph',
              ind: `<w:ind w:left="${720 * (level + 1)}"${wasFirst ? ' w:hanging="360"' : ''}/>`,
            })
          })
          .join('')
      })
      .join('')
  }

  private table(b: Extract<Block, { t: 'table' }>): string {
    // A page that starts with a table starts with an empty line that carries the break: the table cannot.
    const before = this.pageBreak ? this.para('') : ''
    const columns = Math.max(1, ...b.rows.map((r) => r.length))
    const width = Math.floor(TEXT_WIDTH / columns)
    const JC = { l: 'left', c: 'center', r: 'right' } as const
    const rows = b.rows
      .map((cells, ri) => {
        const padded = [
          ...cells,
          ...Array.from({ length: columns - cells.length }, () => [] as Inline[]),
        ]
        const tcs = padded
          .map((cell, i) => {
            const align = b.align[i]
            const jc = align ? JC[align[0] as keyof typeof JC] : undefined
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${this.para(this.runs(cell, ri === 0), jc ? { jc } : {})}</w:tc>`
          })
          .join('')
        return `<w:tr>${ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tcs}</w:tr>`
      })
      .join('')
    const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('')
    // A paragraph after the table: Word needs one between two tables, and a table cannot end the page's text.
    const after = this.para('')
    return `${before}<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${width * columns}" w:type="dxa"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>${after}`
  }

  scene(s: ExportScene, first: boolean, levels: ReturnType<typeof levelsOf>): string {
    this.notes = new Map(s.notes.map((n) => [n.n, n.c]))
    const out: string[] = []
    if (this.profile.sceneTitles)
      out.push(
        this.para(`<w:r><w:t xml:space="preserve">${esc(s.title)}</w:t></w:r>`, {
          style: `Heading${levels.scene}`,
        }),
      )
    else if (!first) out.push(this.separator())
    out.push(this.blocks(s.blocks, {}, 0, levels.scene))
    if (s.choices.length) {
      out.push(this.para('<w:r><w:rPr><w:b/></w:rPr><w:t>Choices</w:t></w:r>', { keep: true }))
      for (const c of s.choices)
        out.push(
          this.para(
            `<w:r><w:t xml:space="preserve">${esc(`${c.label} → ${c.target}`)}</w:t></w:r>`,
            {
              style: 'ListParagraph',
              num: '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
            },
          ),
        )
    }
    return out.join('')
  }
}

function styles(p: ExportProfile): string {
  const font = FONTS[p.font]
  const size = Math.round(p.fontSize * 2)
  const line = Math.round(p.spacing * 240)
  const heading = (n: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n < 3 ? 360 : 240}" w:after="120"/>${n === 1 ? '<w:jc w:val="center"/>' : ''}<w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(size * (n === 1 ? 1.5 : n === 2 ? 1.25 : 1.1))}"/></w:rPr></w:style>`
  return `${HEAD}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${esc(validLanguage(p.language))}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="3600" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size * 3}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="${Math.round(size * 1.5)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Author"><w:name w:val="Author"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="480"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="${Math.round(size * 1.25)}"/></w:rPr></w:style>
${[1, 2, 3, 4, 5, 6].map(heading).join('\n')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="${Math.round(size * 0.85)}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Separator"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="${Math.round(size * 0.8)}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`
}

/** Nine levels of bullets (abstract 0) and of numbers (abstract 1); each ordered list is its own `num`, so each starts where it says. */
function numbering(starts: number[]): string {
  const level = (i: number, bullet: boolean) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? 'bullet' : i % 3 === 1 ? 'lowerLetter' : i % 3 === 2 ? 'lowerRoman' : 'decimal'}"/><w:lvlText w:val="${bullet ? '•' : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  const abstract = (id: number, bullet: boolean) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => level(i, bullet)).join('')}</w:abstractNum>`
  const nums = [
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    ...starts.map(
      (start, i) =>
        `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
    ),
  ]
  return `${HEAD}<w:numbering xmlns:w="${NS_W}">${abstract(0, true)}${abstract(1, false)}${nums.join('')}</w:numbering>`
}

const FOOT_SEP =
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'

/** The parts of the Word document, in a fixed order. */
function docxFiles(book: ExportBook, profile: ExportProfile): ZipFile[] {
  const w = new Writer(profile)
  const levels = levelsOf(book)
  const body: string[] = []
  if (profile.titlePage) {
    body.push(
      w.para(`<w:r><w:t xml:space="preserve">${esc(book.title)}</w:t></w:r>`, { style: 'Title' }),
    )
    if (book.subtitle)
      body.push(
        w.para(`<w:r><w:t xml:space="preserve">${esc(book.subtitle)}</w:t></w:r>`, {
          style: 'Subtitle',
        }),
      )
    if (book.author)
      body.push(
        w.para(`<w:r><w:t xml:space="preserve">${esc(book.author)}</w:t></w:r>`, {
          style: 'Author',
        }),
      )
    w.pageBreak = true
  }
  for (const c of book.chapters) {
    const heading = chapterHeading(c, profile.chapterTitles)
    if (c.part) {
      w.pageBreak = true
      body.push(
        w.para(`<w:r><w:t xml:space="preserve">${esc(c.part)}</w:t></w:r>`, {
          style: `Heading${levels.part}`,
        }),
      )
    } else w.pageBreak = true
    if (heading)
      body.push(
        w.para(`<w:r><w:t xml:space="preserve">${esc(heading)}</w:t></w:r>`, {
          style: `Heading${levels.chapter}`,
        }),
      )
    c.scenes.forEach((s, i) => body.push(w.scene(s, i === 0, levels)))
  }
  const [pw, ph] = PAGES[profile.pageSize]
  const section = `<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
  const document = `${HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body.join('')}${section}</w:body></w:document>`

  const links = [...w.links].map(
    ([href, id]) =>
      `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(href)}" TargetMode="External"/>`,
  )
  const rels = (items: string[]) =>
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`
  const override = (part: string, type: string) =>
    `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-${type}+xml"/>`
  const type = 'officedocument.wordprocessingml'
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${override('/word/document.xml', `${type}.document.main`)}${override('/word/styles.xml', `${type}.styles`)}${override('/word/numbering.xml', `${type}.numbering`)}${override('/word/footnotes.xml', `${type}.footnotes`)}${override('/word/settings.xml', `${type}.settings`)}${override('/docProps/core.xml', 'package.core-properties')}</Types>`,
    ],
    [
      '_rels/.rels',
      rels([
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`,
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      ]),
    ],
    [
      'docProps/core.xml',
      `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(book.title)}</dc:title>${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ''}<dc:language>${esc(book.language)}</dc:language></cp:coreProperties>`,
    ],
    ['word/document.xml', document],
    [
      'word/_rels/document.xml.rels',
      rels([
        `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
        `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`,
        `<Relationship Id="rId3" Type="${REL}/footnotes" Target="footnotes.xml"/>`,
        `<Relationship Id="rId4" Type="${REL}/settings" Target="settings.xml"/>`,
        ...links,
      ]),
    ],
    ['word/styles.xml', styles(profile)],
    ['word/numbering.xml', numbering(w.orderedStarts)],
    [
      'word/footnotes.xml',
      `${HEAD}<w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}">${FOOT_SEP}${w.footnotes.join('')}</w:footnotes>`,
    ],
    [
      'word/settings.xml',
      `${HEAD}<w:settings xmlns:w="${NS_W}"><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>`,
    ],
  ]
  return files.map(([path, text]) => ({ path, data: encode(text) }))
}

export const docxBlob = (book: ExportBook, profile: ExportProfile): Blob =>
  zipFiles(docxFiles(book, profile), FIXED_ZIP_STAMP, true)
