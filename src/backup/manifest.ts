// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { StorageError } from '@/storage/errors'
import { encode } from '@/storage/hash'
import type { RemoteStore } from '@/storage/remote/remote-store'
import { manifestPath } from './layout'

/** `backup.json`: what a backup folder holds and who wrote it. Compare-and-write rests on `revision` and the server's tag. */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string(),
  /** The workspace's name when it was last backed up. Older manifests have none: the folder's name stands in. */
  name: z.string().optional(),
  deviceId: z.string(),
  deviceName: z.string(),
  /** Goes up by one each time a device claims the folder for a round of uploads. */
  revision: z.number().int().nonnegative(),
  /** False while a round is under way: `files` then says what `current/` is about to hold. */
  complete: z.boolean(),
  lastBackup: z.string(),
  files: z.record(z.string(), z.object({ hash: z.string(), size: z.number() })),
})
export type Manifest = z.infer<typeof manifestSchema>

export const manifestBytes = (m: Manifest) => encode(`${JSON.stringify(m, null, 2)}\n`)

/**
 * The folder's manifest with the tag it must be written against, or null when there is none.
 * One that cannot be read is never replaced: it may be a newer Aurelia's, and the author's
 * backup is not ours to overwrite.
 */
export async function readManifest(
  store: RemoteStore,
  folder: string,
): Promise<{ manifest: Manifest; etag: string | null } | null> {
  const file = await store.read(manifestPath(folder))
  if (!file) return null
  try {
    const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)))
    return { manifest, etag: file.etag }
  } catch {
    throw new StorageError(
      'other',
      'The backup on your server was made by a newer Aurelia, or is damaged. Aurelia left it alone.',
    )
  }
}
