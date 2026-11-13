// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { backupRig } from '../../tests/helpers/backup-rig'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { loadWorkspace } from '@/storage/load'
import {
  downloadVersion,
  fetchBackup,
  listBackups,
  listVersions,
  spaceUsed,
  withNewId,
  writeRestored,
} from './restore'

/** A workspace backed up to a fake server, with its first version saved. */
async function backedUp() {
  const rig = await backupRig({ workspaceName: 'My Book' })
  const engine = await rig.open()
  await engine.turnOn()
  engine.dispose()
  return rig
}

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined)

describe('restoring from the server', () => {
  it('lists the workspaces that have a backup, newest first, and skips folders that are not ours', async () => {
    const rig = await backedUp()
    rig.dav.seed('Aurelia/Photos/a.jpg', 'x')
    rig.dav.seed('Aurelia/Broken (wsp_zzzzzzzzzz)/backup.json', 'not json')
    const found = await listBackups(rig.store)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      folder: rig.folder,
      name: 'My Book',
      workspaceId: rig.id,
      device: null,
      deviceName: 'Chrome on macOS',
      files: 5,
    })
  })

  it('reads the latest backup back with no problems, and it opens as the same workspace', async () => {
    const rig = await backedUp()
    const { files, problems } = await fetchBackup(rig.store, rig.folder, 'current')
    expect(problems).toEqual([])
    expect([...files.keys()].sort()).toEqual((await rig.adapter.list()).sort())

    const target = new MemoryAdapter()
    await writeRestored(target, files)
    const loaded = await loadWorkspace(target)
    expect(loaded.data.workspace.id).toBe(rig.id)
    expect(loaded.problems).toEqual([])
    for (const path of await rig.adapter.list())
      expect((await target.read(path))?.hash).toBe((await rig.adapter.read(path))?.hash)
  })

  it('refuses a file that changed on the server: it is named, never accepted', async () => {
    const rig = await backedUp()
    const scene = await rig.scenePath()
    rig.dav.tamper(`${rig.folder}/current/${scene}`, 'Someone edited this on the server.')
    const { problems } = await fetchBackup(rig.store, rig.folder, 'current')
    expect(problems).toEqual([{ path: scene, kind: 'changed' }])
  })

  it('names a file that is gone from the server', async () => {
    const rig = await backedUp()
    const scene = await rig.scenePath()
    rig.dav.files.delete(`${rig.folder}/current/${scene}`)
    const { problems, files } = await fetchBackup(rig.store, rig.folder, 'current')
    expect(problems).toEqual([{ path: scene, kind: 'missing' }])
    expect(files.has(scene)).toBe(false)
  })

  it('names a file that is not text, because the workspace cannot hold it', async () => {
    const rig = await backedUp()
    const scene = await rig.scenePath()
    const bad = new Uint8Array([0xff, 0xfe, 0xfd])
    rig.dav.files.get(`${rig.folder}/current/${scene}`)!.bytes = bad
    const manifest = rig.dav.json<{ files: Record<string, { hash: string; size: number }> }>(
      `${rig.folder}/backup.json`,
    )
    manifest.files[scene]!.hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bad)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    rig.dav.tamper(`${rig.folder}/backup.json`, JSON.stringify(manifest))
    const { problems } = await fetchBackup(rig.store, rig.folder, 'current')
    expect(problems).toEqual([{ path: scene, kind: 'unreadable' }])
  })

  it('says so when there is no backup in the folder', async () => {
    const rig = await backupRig()
    await expect(
      fetchBackup(rig.store, 'Aurelia/Nothing (wsp_aaaaaaaaaa)', 'current'),
    ).rejects.toThrow(/no backup/)
  })

  it('lists versions newest first, and reads one back checked against its CRC', async () => {
    const rig = await backedUp()
    rig.dav.seed(`${rig.folder}/versions/2026-11-01T10-00-00_before-use-file.zip`, 'old')
    const versions = await listVersions(rig.store, rig.folder)
    expect(versions.map((v) => [v.name, v.reason])).toEqual([
      ['2026-11-12T18-30-00.zip', null],
      ['2026-11-01T10-00-00_before-use-file.zip', 'before-use-file'],
    ])
    const { files, problems } = await fetchBackup(rig.store, rig.folder, versions[0]!.name)
    expect(problems).toEqual([])
    expect([...files.keys()].sort()).toEqual((await rig.adapter.list()).sort())
    expect(text(files.get('aurelia.json'))).toBe((await rig.adapter.read('aurelia.json'))!.text)
  })

  it('refuses a version whose bytes were damaged', async () => {
    const rig = await backedUp()
    const name = '2026-11-12T18-30-00.zip'
    const stored = rig.dav.files.get(`${rig.folder}/versions/${name}`)!
    const at = Buffer.from(stored.bytes).indexOf('"schemaVersion"') // inside a file's bytes, not a header
    expect(at).toBeGreaterThan(0)
    stored.bytes[at + 3] = stored.bytes[at + 3]! ^ 0xff
    const { problems } = await fetchBackup(rig.store, rig.folder, name)
    expect(problems.some((p) => p.kind === 'changed')).toBe(true)
  })

  it('a version that is not a zip of ours is an error, not a workspace', async () => {
    const rig = await backedUp()
    rig.dav.seed(`${rig.folder}/versions/2026-11-12T20-00-00.zip`, 'this is not a zip at all')
    await expect(fetchBackup(rig.store, rig.folder, '2026-11-12T20-00-00.zip')).rejects.toThrow(
      /zip/,
    )
  })

  it('gives the same workspace a new ID without touching any other file', async () => {
    const rig = await backedUp()
    const { files } = await fetchBackup(rig.store, rig.folder, 'current')
    const moved = withNewId(files, 'wsp_bbbbbbbbbb')
    expect(JSON.parse(text(moved.get('aurelia.json'))!).id).toBe('wsp_bbbbbbbbbb')
    expect(JSON.parse(text(moved.get('aurelia.json'))!).name).toBe('My Book')
    for (const [path, bytes] of files)
      if (path !== 'aurelia.json') expect(moved.get(path)).toBe(bytes)
    expect(text(files.get('aurelia.json'))).toContain(rig.id) // the original map is untouched
  })

  it('writes aurelia.json last, so a half-restored folder is not a workspace', async () => {
    const rig = await backedUp()
    const { files } = await fetchBackup(rig.store, rig.folder, 'current')
    const target = new MemoryAdapter()
    const order: string[] = []
    target.beforeWrite = (path) => void order.push(path)
    await writeRestored(target, files)
    expect(order.at(-1)).toBe('aurelia.json')
    expect(order).toHaveLength(files.size)
  })

  it('downloads a version as a zip and measures the space a backup takes', async () => {
    const rig = await backedUp()
    const blob = await downloadVersion(rig.store, rig.folder, '2026-11-12T18-30-00.zip')
    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBe(
      rig.dav.files.get(`${rig.folder}/versions/2026-11-12T18-30-00.zip`)!.bytes.length,
    )
    const used = await spaceUsed(rig.store, rig.folder)
    expect(used).toBeGreaterThan(blob.size)
  })
})
