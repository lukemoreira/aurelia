// SPDX-License-Identifier: AGPL-3.0-or-later
// One sync round (ADR-0012): list the server, plan, act, and leave `backup.json` true.
import { RemoteError, StorageError } from '@/storage/errors'
import { hashBytes } from '@/storage/hash'
import { WORKSPACE_FILE } from '@/storage/paths'
import type { RemoteStore } from '@/storage/remote/remote-store'
import type { RemoteChange } from '@/storage/session'
import { currentPath, manifestPath } from './layout'
import { derivedOnly, mergeLists } from './merge-workspace'
import { manifestBytes, readManifest, type Manifest, type SyncInfo } from './manifest'
import type { BackupState, Device } from './state'
import { copyNameFor, planSync, type SyncAction } from './sync-plan'

export interface SyncSource {
  id: string
  name: () => string
  adapter: { readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> }
  /** Write what came from another device, through the session. */
  apply: (changes: RemoteChange[]) => Promise<Map<string, 'applied' | 'deferred'>>
}

export interface SyncContext {
  store: RemoteStore
  folder: string
  source: SyncSource
  device: Device
  /** Mutated as the round goes: `base`, `revision`, `name`, `lastBackup`, `uploaded`. */
  state: BackupState
  now: number
  /** Every saved file with its hash, once pending saves have landed. */
  scan: () => Promise<Map<string, string>>
  /** Called once, before the first local file is overwritten or deleted: saves a version, or throws. */
  beforeChange: () => Promise<void>
  /** There is something to do: the screens say "Syncing…". */
  working: () => void
  /** Another device owns a plain backup in this folder. Throws. */
  ask: (m: Manifest) => never
  /** The devices the manifest lists, as of this round. */
  devices: (d: SyncInfo['devices']) => void
}

export interface SyncResult {
  /** A file was pushed, removed or written here: a version is due. */
  changed: boolean
}

const PASSES = 4
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const textOf = (bytes: Uint8Array) => {
  try {
    return utf8.decode(bytes)
  } catch {
    return null // not text: never written to a workspace, never deleted either
  }
}

/** Every file below `root` on the server, by path relative to it, with its tag. Folders are walked one level at a time. */
async function listTree(store: RemoteStore, root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let level = [root]
  while (level.length) {
    const lists = await Promise.all(level.map((p) => store.list(p)))
    level = []
    for (const entries of lists)
      for (const e of entries) {
        if (e.folder) level.push(e.path)
        else if (!e.etag)
          throw new StorageError(
            'other',
            'Your server does not give each file a version tag, so Aurelia cannot keep devices in sync through it.',
          )
        else out.set(e.path.slice(root.length + 1), e.etag)
      }
  }
  return out
}

/** Rounds until one finishes without a write that lost a race (at most four, then the engine retries later). */
export async function syncRound(ctx: SyncContext): Promise<SyncResult> {
  let changed = false
  // What this round deleted or brought back, kept across passes: a pass whose manifest write lost a race reads
  // the other device's manifest next, which knows nothing of it.
  const carry: Carry = { added: {}, cleared: new Set() }
  for (let pass = 0; pass < PASSES; pass++) {
    const r = await onePass(ctx, carry)
    changed ||= r.changed
    if (!r.again) return { changed }
  }
  throw new RemoteError('precondition', 'sync: the folder kept changing')
}

interface Carry {
  added: SyncInfo['tombstones']
  cleared: Set<string>
}

async function onePass(ctx: SyncContext, carry: Carry): Promise<SyncResult & { again: boolean }> {
  const { store, folder, source, state: s } = ctx
  const local = await ctx.scan()
  let found = await readManifest(store, folder)
  // A folder with a sync set belongs to every device in it; a plain backup belongs to its writer.
  if (found && !found.manifest.sync && found.manifest.deviceId !== ctx.device.id)
    ctx.ask(found.manifest)
  const remote = await listTree(store, `${folder}/current`)
  const base = (s.base ??= seedBase(ctx, found?.manifest, remote))
  const tombstones: SyncInfo['tombstones'] = { ...found?.manifest.sync?.tombstones, ...carry.added }
  for (const path of carry.cleared) delete tombstones[path]
  const actions = planSync({ local, remote, base, tombstones })
  if (actions.length) ctx.working()
  const stamp = new Date(ctx.now).toISOString()
  const deletes = actions.filter((a) => a.kind === 'remove-remote')
  if (deletes.length) {
    // The tombstones go in before the files go out, so a device that looks in between finds a delete, not a loss.
    // (No manifest yet: it is made at the end of this pass, and the deletes wait for the next.)
    if (!found) return { changed: false, again: (await closeManifest()) || true }
    for (const a of deletes) {
      carry.added[a.path] = tombstones[a.path] = { hash: base[a.path]!.hash, at: stamp }
      carry.cleared.delete(a.path)
    }
    const announced: Manifest = {
      ...found.manifest,
      deviceId: ctx.device.id,
      deviceName: ctx.device.name,
      revision: found.manifest.revision + 1,
      lastBackup: stamp,
      sync: {
        devices: {
          ...found.manifest.sync?.devices,
          [ctx.device.id]: { name: ctx.device.name, at: stamp },
        },
        tombstones,
      },
    }
    try {
      const tag = await store.write(
        manifestPath(folder),
        manifestBytes(announced),
        found.etag ? { ifMatch: found.etag } : { ifNoneMatch: '*' },
      )
      found = {
        manifest: announced,
        etag: tag ?? (await store.read(manifestPath(folder)))?.etag ?? null,
      }
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'precondition')
        return { changed: false, again: true }
      throw e
    }
  }
  if (actions.some((a) => a.kind === 'remove-local' || (a.kind === 'pull' && a.expect !== null)))
    await ctx.beforeChange()

  let again = false
  let changed = false
  /** Hash and size of the bytes now on the server, for what this pass wrote or read. */
  const fresh = new Map<string, { hash: string; size: number }>()
  const now = new Map(remote) // the server's tags as they are after this pass

  const push = async (path: string, ifMatch: string | null, bytes?: Uint8Array<ArrayBuffer>) => {
    const data = bytes ?? (await source.adapter.readBytes(path))
    if (!data) return // removed since the scan: the next round sees it
    const hash = await hashBytes(data)
    const target = currentPath(folder, path)
    try {
      const tag = await store.write(target, data, ifMatch ? { ifMatch } : { ifNoneMatch: '*' })
      const etag = tag ?? (await store.read(target))?.etag
      if (!etag) throw new StorageError('other', 'Your server gave no version tag for a file.')
      base[path] = { etag, hash }
      fresh.set(path, { hash, size: data.length })
      now.set(path, etag)
      changed = true
      if (tombstones[path]) {
        delete tombstones[path]
        delete carry.added[path]
        carry.cleared.add(path)
      }
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'precondition') throw e
      again = true // someone wrote first: look at the folder again
    }
  }

  const act = async (a: SyncAction) => {
    const { path } = a
    switch (a.kind) {
      case 'forget':
        delete base[path]
        return
      case 'push':
        return push(path, a.ifMatch)
      case 'remove-remote':
        try {
          await store.remove(currentPath(folder, path), { ifMatch: a.ifMatch })
        } catch (e) {
          if (e instanceof RemoteError && e.code === 'precondition') return void (again = true)
          throw e
        }
        changed = true
        delete base[path]
        now.delete(path)
        return
      case 'remove-local':
        if (
          (await source.apply([{ path, text: null, expect: a.expect }])).get(path) === 'applied'
        ) {
          delete base[path]
          changed = true
        }
        return
      case 'pull':
      case 'compare': {
        const got = await store.read(currentPath(folder, path))
        if (!got) return void (again = true)
        const hash = await hashBytes(got.bytes)
        if (!got.etag)
          throw new StorageError('other', 'Your server gave no version tag for a file.')
        fresh.set(path, { hash, size: got.bytes.length })
        now.set(path, got.etag)
        const mine = local.get(path)
        if (mine === hash) {
          base[path] = { etag: got.etag, hash } // both sides already hold these bytes
          return
        }
        const text = textOf(got.bytes)
        if (text === null) return // not text: left alone
        if (a.kind === 'pull') {
          const done = await source.apply([{ path, text, expect: a.expect }])
          if (done.get(path) === 'applied') {
            base[path] = { etag: got.etag, hash }
            changed = true
          }
          return
        }
        // Only the lists of the workspace file differ: put together, no copy.
        if (path === WORKSPACE_FILE && mine !== undefined) {
          const own = await source.adapter.readBytes(path)
          const merged = own && mergeLists(new TextDecoder().decode(own), text)
          if (merged) {
            const done = await source.apply([{ path, text: merged, expect: mine }])
            if (done.get(path) !== 'applied') return
            changed = true
            return push(path, got.etag)
          }
        }
        // A derived file (the outline of a book): no copy. Mine goes up, and the device rewrites it from the scenes.
        const own = await source.adapter.readBytes(path)
        if (own && derivedOnly(path, new TextDecoder().decode(own), text)) {
          changed = true
          return push(path, got.etag)
        }
        // Both texts are kept: the server's goes beside the file as a copy, mine stays in place.
        const copy = copyNameFor(path, hash)
        const there = await source.adapter.readBytes(copy)
        if (there ? (await hashBytes(there)) !== hash : false) return // a different file holds that name
        if (!there) {
          const done = await source.apply([{ path: copy, text, expect: null }])
          if (done.get(copy) !== 'applied') return
          changed = true
        }
        await push(copy, null, got.bytes)
        await push(path, got.etag)
        return
      }
    }
  }
  for (const a of actions) await act(a)

  return { changed, again: again || (await closeManifest()) }

  /** Write `backup.json` when it is out of date: true when that lost a race and the pass must be repeated. */
  async function closeManifest(): Promise<boolean> {
    const files: Manifest['files'] = {}
    for (const [path, etag] of now) {
      const read = fresh.get(path)
      const kept = base[path]?.etag === etag ? found?.manifest.files[path] : undefined
      const old = found?.manifest.files[path]
      if (read) files[path] = read
      else if (kept && kept.hash === base[path]?.hash) files[path] = kept
      else if (base[path]?.etag === etag)
        files[path] = {
          hash: base[path].hash,
          size: (await source.adapter.readBytes(path))?.length ?? old?.size ?? 0,
        }
      else if (old) files[path] = old // not read this pass: what the manifest said stays
    }
    const sameFiles =
      !!found &&
      Object.keys(files).length === Object.keys(found.manifest.files).length &&
      Object.entries(files).every(([p, f]) => found.manifest.files[p]?.hash === f.hash)
    const sync = found?.manifest.sync
    const devices = { ...sync?.devices }
    const name = source.name()
    const joined = !!devices[ctx.device.id]
    const tombstonesChanged =
      JSON.stringify(Object.entries(tombstones).sort()) !==
      JSON.stringify(Object.entries(sync?.tombstones ?? {}).sort())
    if (found && sameFiles && joined && !tombstonesChanged && found.manifest.name === name) {
      finish(found.manifest.revision, files)
      ctx.devices(devices)
      return false
    }
    devices[ctx.device.id] = { name: ctx.device.name, at: new Date(ctx.now).toISOString() }
    const manifest: Manifest = {
      schemaVersion: 1,
      workspaceId: source.id,
      name,
      deviceId: ctx.device.id,
      deviceName: ctx.device.name,
      revision: (found?.manifest.revision ?? 0) + 1,
      complete: true,
      lastBackup: new Date(ctx.now).toISOString(),
      files,
      sync: { devices, tombstones },
    }
    try {
      await store.write(
        manifestPath(folder),
        manifestBytes(manifest),
        found?.etag ? { ifMatch: found.etag } : { ifNoneMatch: '*' },
      )
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'precondition') return true
      throw e
    }
    finish(manifest.revision, files)
    ctx.devices(devices)
    return false
  }

  function finish(revision: number, files: Manifest['files']) {
    s.revision = revision
    s.name = source.name()
    s.claimOpen = false
    s.lastBackup = ctx.now
    s.uploaded = Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.hash]))
  }
}

/**
 * The first round of a device that already backed this folder up has a base for free: the manifest
 * it wrote lists what is on the server, and nobody else wrote since (a folder of a plain backup has
 * one writer). Anything else compares each file once.
 */
function seedBase(ctx: SyncContext, m: Manifest | undefined, remote: Map<string, string>) {
  const out: NonNullable<BackupState['base']> = {}
  if (!m || m.sync || !m.complete || m.deviceId !== ctx.device.id) return out
  for (const [path, f] of Object.entries(m.files)) {
    const etag = remote.get(path)
    if (etag) out[path] = { etag, hash: f.hash }
  }
  return out
}
