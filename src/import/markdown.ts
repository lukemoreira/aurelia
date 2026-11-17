// SPDX-License-Identifier: AGPL-3.0-or-later
// Markdown files as a plan (ADR-0014): a folder is a chapter, a file is a scene, in natural order
// ("2" before "10"); a title is the file's own `title:`, else its first heading, else its name.
import { parseFrontmatter, splitDocument } from '@/storage/frontmatter'
import {
  emptyReport,
  report,
  titleOf,
  type ImportPlan,
  type PlanChapter,
  type PlanScene,
} from './plan'

export interface TextFile {
  /** Relative, with `/`: `Part one/02 The bridge.md`. */
  path: string
  text: string
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
/** Natural order, folder by folder: "Chapter 2" before "Chapter 10", "a/b" before "a/c". */
export function naturalCompare(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    // A file sorts before the folders next to it.
    const fileX = i === x.length - 1
    const fileY = i === y.length - 1
    if (fileX !== fileY) return fileX ? -1 : 1
    const c = collator.compare(x[i]!, y[i]!)
    if (c) return c
  }
  return x.length - y.length
}

/** A name read as a title: no extension, no number in front ("02 - The bridge" → "The bridge"), dashes as spaces. */
function titleFromName(name: string, extension = true): string {
  const stem = (extension ? name.replace(/\.[^./]+$/, '') : name).replace(/^\d+[\s._-]+/, '')
  const spaced = /\s/.test(stem) ? stem : stem.replace(/[-_]+/g, ' ')
  const title = spaced.trim()
  return title ? title[0]!.toUpperCase() + title.slice(1) : ''
}

/** The top folder first, then the others in natural order, folder by folder. */
function compareDirs(a: string, b: string): number {
  if (a === b) return 0
  if (a === '' || b === '') return a === '' ? -1 : 1
  const [x, y] = [a.split('/'), b.split('/')]
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = collator.compare(x[i]!, y[i]!)
    if (c) return c
  }
  return x.length - y.length
}

const FIRST_HEADING = /^[ \t]*#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/

interface Read {
  title: string
  body: string
  /** The chapter the file says it is in (Aurelia's own export writes it): a folder name is a poorer title. */
  chapter?: string
  /** The details at the top, other than the ones an import uses. */
  dropped: string[]
}

/** Details an import uses (`title`, `chapter`) or has no use for (`book`: the zip's own folder names it). */
const USED = new Set(['title', 'chapter', 'book'])

function readScene(file: TextFile, unreadable: string[]): Read {
  const name = file.path.split('/').at(-1)!
  const text = file.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let body = text
  let title = ''
  let chapter: string | undefined
  const dropped: string[] = []
  const parts = splitDocument(text)
  if (parts) {
    try {
      const data = parseFrontmatter(parts.yaml)
      // Details are a mapping. A file that opens with a scene break (`---`) is text: anything else is not details.
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        body = parts.body
        const fields = data as Record<string, unknown>
        const t = fields.title
        if (typeof t === 'string' || typeof t === 'number') title = String(t)
        if (typeof fields.chapter === 'string' && fields.chapter.trim()) chapter = fields.chapter
        for (const key of Object.keys(fields)) if (!USED.has(key)) dropped.push(key)
      }
    } catch {
      unreadable.push(file.path) // the details are kept as the first lines of the text
    }
  }
  body = body.replace(/^(?:[ \t]*\n)+/, '')
  if (!title.trim()) {
    const first = body.split('\n', 1)[0]!
    const heading = FIRST_HEADING.exec(first)
    // The heading is the title, and is not repeated, only when the title keeps all of it (one that is cut would lose words).
    if (heading && titleOf(heading[1]!, '') === heading[1]!.trim()) {
      title = heading[1]!
      body = body.slice(first.length).replace(/^\n(?:[ \t]*\n)*/, '')
    }
  }
  const trimmed = body.replace(/\s+$/, '')
  return {
    title: titleOf(title, titleOf(titleFromName(name), 'Untitled scene')),
    body: trimmed ? `${trimmed}\n` : '',
    ...(chapter ? { chapter } : {}),
    dropped,
  }
}

/**
 * The plan for Markdown files. Each folder (the whole path above a file) is one chapter, named by its last
 * folder; files straight in the top folder are the first chapter. Order is natural, folder by folder.
 */
export function markdownPlan(files: TextFile[], title: string): ImportPlan {
  const notes = emptyReport()
  const broken: string[] = []
  const byDir = new Map<string, TextFile[]>()
  for (const f of [...files].sort((a, b) => naturalCompare(a.path, b.path))) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    byDir.set(dir, [...(byDir.get(dir) ?? []), f])
  }
  const dirs = [...byDir.keys()].sort(compareDirs)
  const chapters: PlanChapter[] = []
  let n = 0
  for (const dir of dirs) {
    let named: string | undefined
    const scenes: PlanScene[] = byDir.get(dir)!.map((file) => {
      const read = readScene(file, broken)
      named ??= read.chapter
      if (read.dropped.length)
        report(
          notes.notes,
          `Only the title is kept from the details at the top: ${read.dropped.join(', ')}`,
          file.path,
        )
      return { key: `s${++n}`, title: read.title, body: read.body, choices: [] }
    })
    const last = dir.split('/').at(-1)!
    chapters.push({
      title: titleOf(
        named ?? titleFromName(last, false),
        titleOf(titleFromName(last, false), `Chapter ${chapters.length + 1}`),
      ),
      scenes,
    })
  }
  for (const path of broken)
    report(
      notes.notes,
      'The details at the top could not be read, so they are kept as the first lines of the text',
      path,
    )
  if (dirs.some((d) => d.includes('/')))
    report(
      notes.notes,
      'A folder inside a folder is a chapter of its own, named by its last folder',
    )
  return {
    source: 'markdown',
    title: titleOf(title, 'Imported writing'),
    mode: 'linear',
    chapters,
    report: notes,
  }
}
