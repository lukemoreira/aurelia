// SPDX-License-Identifier: AGPL-3.0-or-later
// A book's cover art as an export reads it (ADR-0014): the image file and its kind, read once before the
// export runs (the writers are plain functions of their input). A cover that cannot be read is no cover.
import { imageExtension, imageType } from '@/domain/media'
import type { WorkspaceData } from '@/domain/workspace-data'

export interface ExportCover {
  /** The image file's extension, lower case (`png`). */
  ext: string
  /** Its media type, from the extension (`image/png`). */
  type: string
  bytes: Uint8Array<ArrayBuffer>
}

/**
 * The image `book.json` names as the book's `cover`, or nothing: no cover set, an image that was deleted
 * (it waits in Recently deleted), a file that is not there or cannot be read. Never throws.
 */
export async function readCover(
  data: WorkspaceData,
  bookId: string,
  readBytes: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>,
): Promise<ExportCover | undefined> {
  try {
    const id = data.books.find((b) => b.id === bookId)?.cover
    const doc = id ? data.media?.find((m) => m.meta.id === id) : undefined
    const ext = doc && imageExtension(doc.meta.file)
    if (!doc || !ext) return undefined
    const bytes = await readBytes(`universes/${doc.universe}/media/${doc.meta.file}`)
    return bytes?.length ? { ext, type: imageType(ext), bytes } : undefined
  } catch {
    return undefined
  }
}

/** The image as a `data:` address, which the print view (a page of HTML) can draw without a file. */
export function coverDataUri(cover: ExportCover): string {
  let binary = ''
  for (let i = 0; i < cover.bytes.length; i += 0x8000)
    binary += String.fromCharCode(...cover.bytes.subarray(i, i + 0x8000))
  return `data:${cover.type};base64,${btoa(binary)}`
}
