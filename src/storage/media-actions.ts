// SPDX-License-Identifier: AGPL-3.0-or-later
// The media gallery's writes. An image is kept exactly as imported, beside a small JSON file that
// says what it is (caption, credit). The image is written first and the JSON, which is what points
// at it, last: a stop leaves a file nobody lists, never a listing with nothing behind it.
import { newId } from '@/domain/ids'
import { MAX_IMAGE_BYTES, imageExtension, imageType } from '@/domain/media'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import { StorageError } from './errors'
import { hashBytes } from './hash'
import { mediaFilePath, mediaSidecarPath } from './paths'
import type { WorkspaceSession } from './session'

export interface ImportedFile {
  name: string
  type?: string
  bytes: Uint8Array<ArrayBuffer>
}

/** An ID no file of the workspace has, for the sidecar and for the image beside it. */
async function freshMediaId(s: WorkspaceSession, universeId: string, ext: string) {
  for (let tries = 0; tries < 10; tries++) {
    const id = newId('med')
    if (!s.pathOf(id) && !(await s.adapter.readBytes(mediaFilePath(universeId, id, ext)))) return id
  }
  throw new StorageError('other', 'Aurelia could not make a new ID.')
}

/** Import one image into a universe's media folder. Returns its ID once both files are written. */
export function importMedia(
  s: WorkspaceSession,
  universeId: string,
  file: ImportedFile,
): Promise<string> {
  let id = ''
  return s
    .exclusive(async () => {
      if (!s.data.universes.some((u) => u.id === universeId))
        throw new StorageError('other', 'That universe is no longer in the workspace.')
      const ext = imageExtension(file.name, file.type)
      if (!ext)
        throw new StorageError(
          'other',
          `“${file.name}” is not an image Aurelia can show. Use a PNG, JPEG, GIF, WebP, AVIF or SVG file.`,
        )
      if (file.bytes.length > MAX_IMAGE_BYTES)
        throw new StorageError(
          'other',
          `“${file.name}” is bigger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB, which is more than Aurelia keeps as one image.`,
        )
      id = await freshMediaId(s, universeId, ext)
      const image = mediaFilePath(universeId, id, ext)
      await s.adapter.writeBytes(image, file.bytes)
      try {
        const back = await s.adapter.readBytes(image)
        if (!back || (await hashBytes(back)) !== (await hashBytes(file.bytes)))
          throw new StorageError(
            'other',
            `“${file.name}” did not read back the same, so it was not added.`,
          )
        const meta = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          id,
          file: `${id}.${ext}`,
          name: file.name,
          type: file.type || imageType(ext),
          size: file.bytes.length,
        }
        await s.create([
          { path: mediaSidecarPath(universeId, id), text: `${JSON.stringify(meta, null, 2)}\n` },
        ])
      } catch (e) {
        await s.adapter.remove(image).catch(() => undefined) // our own new file, nothing of the author's
        throw e
      }
    })
    .then(() => id)
}
