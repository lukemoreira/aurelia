// SPDX-License-Identifier: AGPL-3.0-or-later
// From what the author picked (files, a folder, a zip) to a plan and its report (ADR-0014). Reading
// writes nothing. A file that cannot be read is named in the report with the reason; it never stops the
// rest, and only too much (more files or bytes than Aurelia reads at once) stops the import, in plain words.
import { ext, hiddenPart, isNoise, isReadable, MARKDOWN, TWEE } from './files'
import { ImportError, ImportLimit, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, mb } from './limits'
import { markdownPlan, naturalCompare, type TextFile } from './markdown'
import { report, type ImportPlan, type Report } from './plan'
import { isTwineHtml, parseTwee, parseTwineHtml, twinePlan } from './twine'
import { listZip } from './unzip'

export interface SourceFile {
  /** Relative, with `/`. */
  path: string
  size: number
  read: () => Promise<Uint8Array<ArrayBuffer>>
}

const stem = (name: string) => name.replace(/\.[^./]+$/, '')
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

/** A file's text, or why it could not be had: a damaged entry, a file the browser could not read, text that is not UTF-8. */
async function readText(f: SourceFile): Promise<{ text: string } | { why: string }> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await f.read()
  } catch (e) {
    return { why: e instanceof ImportError ? `Not read: ${e.message}` : 'Could not be read' }
  }
  try {
    return { text: decode(bytes) }
  } catch {
    return { why: 'Not UTF-8 text, so it could not be read' }
  }
}

/** What the browser's file inputs give: a folder's files carry their folder (`webkitRelativePath`), which names the book. */
export function fromBrowserFiles(files: File[]): { files: SourceFile[]; name: string } {
  const folder = files.length > 0 && files.every((f) => f.webkitRelativePath)
  const name = folder
    ? files[0]!.webkitRelativePath.split('/')[0]!
    : files.length === 1
      ? stem(files[0]!.name)
      : 'Imported writing'
  return {
    name,
    files: files.map((f) => ({
      path: folder ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name,
      size: f.size,
      read: async () => new Uint8Array(await f.arrayBuffer()),
    })),
  }
}

/** Every file of a zip at once, with the folder they all share (the one "Compress folder" makes) taken off. */
async function expandZip(
  file: SourceFile,
  notes: Report,
): Promise<{ files: SourceFile[]; root?: string }> {
  let listing
  try {
    listing = listZip(await file.read())
  } catch (e) {
    if (!(e instanceof ImportError) || e instanceof ImportLimit) throw e
    report(notes.unread, e.message, file.path)
    return { files: [] }
  }
  for (const s of listing.skipped) report(notes.unread, `Left out of the zip: ${s.reason}`, s.path)
  // What a tool adds (`__MACOSX`, `.DS_Store`) must not stand in the way of the one folder the rest share.
  const items = listing.items.filter((i) => !isNoise(i.path))
  const roots = new Set(items.map((i) => i.path.split('/')[0]))
  const root =
    roots.size === 1 && items.every((i) => i.path.includes('/')) ? [...roots][0] : undefined
  return {
    files: items.map((i) => ({
      ...i,
      path: root ? i.path.slice(root.length + 1) : i.path,
    })),
    ...(root ? { root } : {}),
  }
}

/** Read what the author picked into a plan: a book to make, and the report of what could not be read. */
export async function planFromFiles(input: SourceFile[], name: string): Promise<ImportPlan> {
  if (!input.length) throw new ImportError('Choose some files or a folder to bring in.')
  const notes: Report = { unread: [], notes: [] }
  let title = name
  const zips = input.filter((f) => ext(f.path) === 'zip')
  const tooMany = `That is more than ${MAX_FILES} files, more than Aurelia reads at once.`
  // The limits are for what would be read: not an operating system's files, hidden folders or images.
  const wanted = (f: SourceFile) => !isNoise(f.path) && !hiddenPart(f.path) && isReadable(f.path)
  const readable = input.filter(wanted)
  if (readable.length > MAX_FILES) throw new ImportLimit(tooMany)
  if (readable.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES)
    throw new ImportLimit(
      `That is more than ${mb(MAX_TOTAL_BYTES)} of files, more than Aurelia reads at once.`,
    )
  let list: SourceFile[] = []
  for (const f of input) {
    if (ext(f.path) !== 'zip') list.push(f)
    else {
      const zip = await expandZip(f, notes)
      list.push(...zip.files)
      if (zips.length === 1 && zip.root) title = zip.root
    }
  }
  if (list.filter(wanted).length > MAX_FILES) throw new ImportLimit(tooMany)

  // Files an operating system adds are not writing and are not worth a line; hidden folders are named.
  list = list.filter((f) => {
    if (isNoise(f.path)) return false
    const hidden = hiddenPart(f.path)
    if (hidden) report(notes.unread, 'Hidden files and folders are left out', hidden)
    return !hidden
  })

  const handled = new Set<SourceFile>() // files findTwine already put in the report
  const twine = await findTwine(list, notes, handled)
  if (twine) {
    const rest = list.filter((f) => f !== twine.file && !handled.has(f))
    for (const f of rest)
      report(
        notes.unread,
        'A Twine story is imported on its own, so this file was left out',
        f.path,
      )
    const story = twine.html ? twine.html.story : twine.story!
    const plan = twinePlan(
      story,
      title === 'Imported writing' ? stem(twine.file.path.split('/').at(-1)!) : title,
      twine.html?.others,
    )
    if (!plan.chapters.length)
      throw new ImportError('That Twine story has no passages Aurelia can read as scenes.')
    plan.report.unread.unshift(...notes.unread)
    return plan
  }

  const texts: TextFile[] = []
  for (const f of list.sort((a, b) => naturalCompare(a.path, b.path))) {
    if (handled.has(f)) continue
    if (!MARKDOWN.has(ext(f.path))) {
      report(notes.unread, 'Not a Markdown or text file', f.path)
      continue
    }
    if (f.size > MAX_FILE_BYTES) {
      report(notes.unread, `Larger than ${mb(MAX_FILE_BYTES)}`, f.path)
      continue
    }
    const read = await readText(f)
    if ('text' in read) texts.push({ path: f.path, text: read.text })
    else report(notes.unread, read.why, f.path)
  }
  if (!texts.length)
    throw new ImportError(
      'Aurelia found no writing it can read there. It reads Markdown (.md) and text files, a folder or a zip of them, and Twine stories (.twee or published .html).',
    )
  const plan = markdownPlan(texts, title)
  plan.report.unread.unshift(...notes.unread)
  return plan
}

/** The Twine story among the files: a Twee file, or published HTML (the first of each kind, by name). */
async function findTwine(list: SourceFile[], notes: Report, handled: Set<SourceFile>) {
  for (const f of [...list].sort((a, b) => naturalCompare(a.path, b.path))) {
    const kind = ext(f.path)
    const isHtml = kind === 'html' || kind === 'htm'
    if (!isHtml && !TWEE.has(kind)) continue
    handled.add(f)
    if (f.size > MAX_FILE_BYTES) {
      report(notes.unread, `Larger than ${mb(MAX_FILE_BYTES)}`, f.path)
      continue
    }
    const read = await readText(f)
    if ('why' in read) {
      report(notes.unread, read.why, f.path)
      continue
    }
    const text = read.text
    if (isHtml && !isTwineHtml(text)) {
      report(notes.unread, 'An HTML page that is not a published Twine story', f.path)
      continue
    }
    handled.delete(f)
    return isHtml ? { file: f, html: parseTwineHtml(text) } : { file: f, story: parseTwee(text) }
  }
  return undefined
}
