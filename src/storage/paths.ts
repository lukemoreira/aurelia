// SPDX-License-Identifier: AGPL-3.0-or-later
// The folder layout of ADR-0003, in one place. Paths come from IDs, never from titles.

export const WORKSPACE_FILE = 'aurelia.json'
/** Device-independent bookkeeping that is never read as workspace content. */
export const AURELIA_DIR = '.aurelia/'
const CONFLICTS_DIR = '.aurelia/conflicts'
/** Where a deleted item waits to be restored: `.aurelia/trash/<stamp>/<its path>`, with a `manifest.json` beside. */
export const TRASH_DIR = '.aurelia/trash'

const book = (universe: string, id: string) => `universes/${universe}/books/${id}`
export const universePath = (universe: string) => `universes/${universe}/universe.md`
export const bookPath = (universe: string, id: string) => `${book(universe, id)}/book.json`
export const chapterPath = (universe: string, bookId: string, id: string) =>
  `${book(universe, bookId)}/chapters/${id}.md`
export const scenePath = (universe: string, bookId: string, id: string) =>
  `${book(universe, bookId)}/scenes/${id}.md`
export const partPath = (universe: string, bookId: string, id: string) =>
  `${book(universe, bookId)}/parts/${id}.md`
/** The derived, read-only outline of a book (ADR-0003 rule 9). */
export const outlinePath = (universe: string, bookId: string) =>
  `${book(universe, bookId)}/OUTLINE.md`
/** A record: shared by the universe, or private to a book (`scope`). */
export const recordPath = (universe: string, scope: string, folder: string, id: string) =>
  scope === 'universe'
    ? `universes/${universe}/records/${folder}/${id}.md`
    : `${book(universe, scope.slice(5))}/records/${folder}/${id}.md`

/** An image of a universe's media folder, and the JSON beside it that holds its caption and credit. */
export const mediaFilePath = (universe: string, id: string, ext: string) =>
  `universes/${universe}/media/${id}.${ext}`
export const mediaSidecarPath = (universe: string, id: string) =>
  mediaFilePath(universe, id, 'json')

export type FileKind =
  | { kind: 'universe'; universe: string }
  | { kind: 'book' | 'outline' | 'part' | 'chapter' | 'scene'; universe: string; book: string }
  | { kind: 'record'; universe: string }
  | { kind: 'media'; universe: string }
  | { kind: 'other' }

const BOOK_FILE =
  /^universes\/(unv_\w+)\/books\/(bok_\w+)\/(book\.json|OUTLINE\.md|(parts|chapters|scenes)\/[^/]+\.md)$/
const BOOK_KIND = { parts: 'part', chapters: 'chapter', scenes: 'scene' } as const

/** What a path is, by where it sits. The frontmatter is the truth; this only says how to read it. */
export function classify(path: string): FileKind {
  const b = BOOK_FILE.exec(path)
  if (b) {
    const dir = b[4] as keyof typeof BOOK_KIND | undefined
    const kind = dir ? BOOK_KIND[dir] : b[3] === 'OUTLINE.md' ? 'outline' : 'book'
    return { kind, universe: b[1]!, book: b[2]! }
  }
  const u = /^universes\/(unv_\w+)\/universe\.md$/.exec(path)
  if (u) return { kind: 'universe', universe: u[1]! }
  // Records of a universe, or private to one book: …/records/<kind>/<id>.md
  const r = /^universes\/(unv_\w+)\/(?:books\/bok_\w+\/)?records\/.+\.md$/.exec(path)
  if (r) return { kind: 'record', universe: r[1]! }
  const m = /^universes\/(unv_\w+)\/media\/med_\w+\.json$/.exec(path)
  return m ? { kind: 'media', universe: m[1]! } : { kind: 'other' }
}

/**
 * A file of the media folder that is not text: the image as it was imported (ADR-0003), or its
 * copy waiting in the trash or set aside. It is never read as text, so never rewritten; it travels
 * in a backup and a sync as the bytes it is.
 */
export const isMediaBinary = (path: string) =>
  /^(?:\.aurelia\/(?:trash|conflicts|safety)\/[^/]+\/)?universes\/unv_\w+\/media\/med_\w+(?: \(Aurelia copy [0-9a-f]+\))?\.(?!json$)[a-z0-9]+$/.test(
    path,
  )

// Dropbox, Nextcloud and our own copies write “name (… copy …).ext” — or after the whole name,
// “book.json (conflicted copy)”. Syncthing writes “name.sync-conflict-DATE-TIME-ID.ext”.
const PARENTHESIS = /^(.+?) \([^)]*\bcopy\b[^)]*\)(\.[^./ ]+)?$/i
const SYNCTHING = /^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(\.[^./]+)?$/

/** The file a conflicted copy was made from, or null when the path is not a conflicted copy. */
export function conflictedCopyOf(path: string): string | null {
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const name = path.slice(slash + 1)
  const m = PARENTHESIS.exec(name) ?? SYNCTHING.exec(name)
  return m ? `${dir}${m[1]}${m[2] ?? ''}` : null
}

/** “scenes/scn_x.md” → “scenes/scn_x (Aurelia copy).md”; later copies are numbered. */
export function copyPathFor(path: string, n = 1): string {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${path.slice(0, slash + 1)}${stem} (Aurelia copy${n > 1 ? ` ${n}` : ''})${ext}`
}

/** A moment as a folder name: `2026-11-12T22-30-01-123Z`. */
export const stampOf = (now: Date) => now.toISOString().replace(/[:.]/g, '-')

/** Where a deleted file waits: `.aurelia/trash/<stamp>/<path>`. */
export const trashPathFor = (path: string, stamp: string) => `${TRASH_DIR}/${stamp}/${path}`

/** Where a file goes when the author chooses the other version: `.aurelia/conflicts/<stamp>/<path>`. */
export const conflictsPathFor = (path: string, now = new Date()) =>
  `${CONFLICTS_DIR}/${stampOf(now)}/${path}`

/** Where a file is copied before a change that touches many of them (Rename everywhere): `.aurelia/safety/<stamp>/<path>`. */
export const safetyPathFor = (path: string, stamp: string) =>
  `${AURELIA_DIR}safety/${stamp}/${path}`
