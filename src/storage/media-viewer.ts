// SPDX-License-Identifier: AGPL-3.0-or-later
// Shows an imported image on screen: object URLs (the page's policy allows `blob:` images, nothing
// else from outside), thumbnails from the device cache or made once and kept there. Plain
// TypeScript; the gallery and the portraits ask it.
import { imageExtension, imageType, isDrawnAsIs } from '@/domain/media'
import type { MediaDoc } from '@/domain/workspace-data'
import { makeThumbnail, type ThumbStore } from './thumbnails'

export interface ViewerDeps {
  readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null>
  workspaceId: string
  thumbs: ThumbStore | null
  /** Replaceable so a test need not decode a picture. */
  makeThumb?: typeof makeThumbnail
  createUrl?: (blob: Blob) => string
  revokeUrl?: (url: string) => void
}

/** How many pictures are read and shrunk at once: a gallery of hundreds never starts them all together. */
const AT_ONCE = 2

export class MediaViewer {
  private urls = new Map<string, Promise<string | null>>()
  private waiting: (() => void)[] = []
  private running = 0

  constructor(private deps: ViewerDeps) {}

  private pathOf = (doc: MediaDoc) => `universes/${doc.universe}/media/${doc.meta.file}`

  /** One at a time (two, rather), in the order asked. */
  private async limited<T>(work: () => Promise<T>): Promise<T> {
    // A place that is freed goes straight to the next in line, so there are never more than AT_ONCE.
    if (this.running < AT_ONCE) this.running++
    else await new Promise<void>((resolve) => this.waiting.push(resolve))
    try {
      return await work()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running--
    }
  }

  private remember(key: string, make: () => Promise<string | null>) {
    const known = this.urls.get(key)
    if (known) return known
    const made = make().catch(() => null)
    this.urls.set(key, made)
    // A picture that could not be read is asked again next time, not remembered as missing.
    void made.then((url) => url === null && this.urls.get(key) === made && this.urls.delete(key))
    return made
  }

  private async fullOf(doc: MediaDoc): Promise<string | null> {
    const bytes = await this.deps.readBytes(this.pathOf(doc))
    if (!bytes) return null
    const ext = imageExtension(doc.meta.file) ?? ''
    const blob = new Blob([bytes], { type: doc.meta.type || imageType(ext) })
    return (this.deps.createUrl ?? URL.createObjectURL)(blob)
  }

  /** The image as imported. */
  full(doc: MediaDoc): Promise<string | null> {
    return this.remember(`full:${doc.meta.id}`, () => this.limited(() => this.fullOf(doc)))
  }

  /** A small picture of it: from the device cache, else made now and kept; the image itself when none can be made. */
  thumb(doc: MediaDoc): Promise<string | null> {
    return this.remember(`thumb:${doc.meta.id}`, () =>
      this.limited(async () => {
        const { thumbs, workspaceId } = this.deps
        const make = (blob: Blob) => (this.deps.createUrl ?? URL.createObjectURL)(blob)
        const cached = await thumbs?.get(workspaceId, doc.meta.id).catch(() => null)
        if (cached) return make(cached)
        const ext = imageExtension(doc.meta.file) ?? ''
        if (isDrawnAsIs(ext)) return this.fullOf(doc)
        const bytes = await this.deps.readBytes(this.pathOf(doc))
        if (!bytes) return null
        const small = await (this.deps.makeThumb ?? makeThumbnail)(
          bytes,
          doc.meta.type || imageType(ext),
        )
        if (!small) return make(new Blob([bytes], { type: doc.meta.type || imageType(ext) }))
        await thumbs?.put(workspaceId, doc.meta.id, small).catch(() => undefined) // a cache that cannot be kept costs a redraw
        return make(small)
      }),
    )
  }

  /** An image was deleted: its pictures and its cached thumbnail go. */
  async forget(id: string) {
    for (const key of [`full:${id}`, `thumb:${id}`]) {
      const url = await this.urls.get(key)
      this.urls.delete(key)
      if (url) (this.deps.revokeUrl ?? URL.revokeObjectURL)(url)
    }
    await this.deps.thumbs?.remove(this.deps.workspaceId, id).catch(() => undefined)
  }
}
