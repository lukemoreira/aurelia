// SPDX-License-Identifier: AGPL-3.0-or-later
// Which files an import counts, reads or ignores. Limits are for what Aurelia would read, not for what is merely
// in the folder (the objects of a `.git`, the images of a zip).

export const ext = (path: string) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

export const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'txt'])
export const TWEE = new Set(['tw', 'twee', 'tw2'])
const OTHER_READABLE = new Set(['html', 'htm', 'zip'])

const SYSTEM = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

/** Files an operating system adds: not writing, not worth a line in the report. */
export const isNoise = (path: string) => {
  const parts = path.split('/')
  return SYSTEM.has(parts.at(-1)!) || parts[0] === '__MACOSX'
}

/** The first hidden folder or file in a path (`.git`, `.obsidian`), if any. */
export const hiddenPart = (path: string) => path.split('/').find((p) => p.startsWith('.'))

/** A file an import reads: Markdown or text, a Twine story, or a zip of them. */
export const isReadable = (path: string) => {
  const e = ext(path)
  return MARKDOWN.has(e) || TWEE.has(e) || OTHER_READABLE.has(e)
}
