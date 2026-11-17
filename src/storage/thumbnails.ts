// SPDX-License-Identifier: AGPL-3.0-or-later
// Thumbnails of the gallery's images: a cache on this device, never a file of the workspace
// (ADR-0003 rule: device-side state stays out of the folder). The browser's private file system
// holds them under `thumbnails/<workspace>/<media id>.webp`; losing them costs a redraw.
import { writeFileBytes } from './safe-write'

/** Where made thumbnails are kept between visits. */
export interface ThumbStore {
  get(workspaceId: string, mediaId: string): Promise<Blob | null>
  put(workspaceId: string, mediaId: string, blob: Blob): Promise<void>
  remove(workspaceId: string, mediaId: string): Promise<void>
}

/** The longest side of a thumbnail, in pixels. */
export const THUMB_SIZE = 360

const ROOT = 'thumbnails'
const gone = (e: unknown) =>
  e instanceof Error && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')

/** The thumbnail cache in the browser's private file system; null where there is none (the gallery then draws the images themselves). */
export function opfsThumbStore(
  root: () => Promise<FileSystemDirectoryHandle> | undefined = () =>
    navigator.storage?.getDirectory?.(),
): ThumbStore | null {
  if (!root()) return null
  const folder = async (workspaceId: string, create: boolean) => {
    const top = await (await root()!).getDirectoryHandle(ROOT, { create })
    return top.getDirectoryHandle(workspaceId, { create })
  }
  return {
    async get(workspaceId, mediaId) {
      try {
        const file = await (await folder(workspaceId, false)).getFileHandle(`${mediaId}.webp`)
        return await file.getFile()
      } catch (e) {
        if (gone(e)) return null
        throw e
      }
    },
    async put(workspaceId, mediaId, blob) {
      const handle = await (
        await folder(workspaceId, true)
      ).getFileHandle(`${mediaId}.webp`, { create: true })
      await writeFileBytes(handle, new Uint8Array(await blob.arrayBuffer()))
    },
    async remove(workspaceId, mediaId) {
      try {
        await (await folder(workspaceId, false)).removeEntry(`${mediaId}.webp`)
      } catch (e) {
        if (!gone(e)) throw e
      }
    },
  }
}

/**
 * A small picture of an image, or null when this browser cannot make one (the image itself is shown
 * then). The decode shrinks as it reads (`resizeWidth`), off the page's thread, so a large file does
 * not freeze the screen; it needs no copy of the whole picture on the page.
 */
export async function makeThumbnail(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
      resizeWidth: THUMB_SIZE,
      resizeQuality: 'medium',
    })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  } catch {
    return null
  }
}
