// SPDX-License-Identifier: AGPL-3.0-or-later
// Which files the media gallery takes, and the limits it keeps. Plain data: no Vue, no storage.

/** The image kinds a browser shows in an `<img>`, by file extension. The file keeps its own extension. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/**
 * The biggest image the gallery takes. Below the 64 MiB a storage server takes in one file (so a
 * backup or a sync is never refused for one), with room for the rest of the upload.
 */
export const MAX_IMAGE_BYTES = 48 * 1024 * 1024

/**
 * The extension an imported file keeps: its own, lower-cased. A name with no extension takes the one
 * its type says. A name whose extension is not an image's is refused, whatever the type claims.
 */
export function imageExtension(name: string, type?: string): string | undefined {
  const own = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase()
  if (own) return Object.hasOwn(IMAGE_TYPES, own) ? own : undefined
  return Object.entries(IMAGE_TYPES).find(([, t]) => t === type)?.[0]
}

/** The kind of image for an extension (what an `<img>` of a blob needs to know). */
export const imageType = (ext: string) =>
  Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext]! : 'application/octet-stream'

/** Images the browser draws as they are, never cut down to a thumbnail: a drawing in SVG is small, a GIF moves. */
export const isDrawnAsIs = (ext: string) => ext === 'svg' || ext === 'gif'
