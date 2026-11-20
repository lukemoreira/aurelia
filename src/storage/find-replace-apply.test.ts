// SPDX-License-Identifier: AGPL-3.0-or-later
// Find and replace goes through the rename writer: a "Before replace" snapshot, the compare, the stop and the undo.
import { describe, expect, it } from 'vitest'
import { planReplace } from '@/index/find-replace'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { applyRename, undoRename } from './rename-everywhere'
import { listSnapshots, readSnapshot } from './snapshots'

const OFF = { matchCase: false, wholeWords: true }
const never = () => Promise.resolve(false)

/** One book with three scenes, two of which say "lamp". */
async function rig() {
  const r = await outlineRig()
  const s = r.session
  const book = s.data.books[0]!.id
  const chapter = s.data.chapters[0]!.id
  const ids = [
    s.data.scenes[0]!.meta.id,
    await s.createScene(chapter),
    await s.createScene(chapter),
  ]
  const bodies = ['The lamp went out.\n', 'No light here.\n', 'LAMP oil, and a [[lamp]].\n']
  for (const [i, id] of ids.entries()) await s.editScene(id, bodies[i]!)
  await s.flush()
  const plan = () =>
    planReplace(
      s.data.scenes.map((x) => ({ id: x.meta.id, where: x.meta.title, body: x.body })),
      'lamp',
      'torch',
      OFF,
      book,
    ).plan
  const text = async (id: string) => (await r.adapter.read(s.pathOf(id)!))!.text
  return { ...r, s, book, ids, plan, text }
}

const all = (plan: { places: { key: string }[] }) => new Set(plan.places.map((p) => p.key))

describe('find and replace: writing it', () => {
  it('takes a "Before replace" snapshot of the book first, then replaces in each scene', async () => {
    const t = await rig()
    const before = await t.text(t.ids[0]!)
    const plan = t.plan()
    const run = await applyRename(t.s, plan, all(plan), {
      snapshotBook: t.book,
      saveVersion: never,
    })
    await t.s.flush()
    expect(run).toMatchObject({ places: 2, done: 2 })
    expect(await t.text(t.ids[0]!)).toContain('The torch went out.')
    expect(await t.text(t.ids[2]!)).toContain('TORCH oil, and a [[lamp]].')
    const [snap] = await listSnapshots(t.adapter)
    expect(snap).toMatchObject({ kind: 'book', target: t.book, reason: 'before-replace' })
    const kept = await readSnapshot(t.adapter, snap!)
    expect(kept.get(t.s.pathOf(t.ids[0]!)!)).toBe(before)
  })

  it('refuses everything, snapshot included, when a scene was typed in since the places were found', async () => {
    const t = await rig()
    const plan = t.plan()
    await t.s.editScene(t.ids[2]!, 'Someone typed in this.\n')
    await t.s.flush()
    const before = await snapshot(t.adapter)
    await expect(
      applyRename(t.s, plan, all(plan), { snapshotBook: t.book, saveVersion: never }),
    ).rejects.toThrow(/changed since the places were found/)
    expect(changes(before, await snapshot(t.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('stops at a scene another app changed, and undo puts every file back byte for byte', async () => {
    const t = await rig()
    const plan = t.plan()
    const originals = await Promise.all(t.ids.map((id) => t.text(id)))
    // Another app edits the last scene's file after Aurelia read it: it must not be overwritten.
    await t.adapter.write(t.s.pathOf(t.ids[2]!)!, `${originals[2]!}Added by another app.\n`)
    const run = await applyRename(t.s, plan, all(plan), {
      snapshotBook: t.book,
      saveVersion: never,
    })
    expect(run.stopped?.why).toBe('save')
    expect(run.done).toBe(1)
    expect(await t.text(t.ids[2]!)).toContain('Added by another app.')
    expect(await t.text(t.ids[2]!)).toContain('LAMP oil')

    const undone = await undoRename(t.s, run)
    await t.s.flush()
    expect(undone).toEqual({ restored: 1, kept: [] })
    expect(await t.text(t.ids[0]!)).toBe(originals[0])
  })

  it('one undo puts every scene back byte for byte', async () => {
    const t = await rig()
    const plan = t.plan()
    const originals = await Promise.all(t.ids.map((id) => t.text(id)))
    const run = await applyRename(t.s, plan, all(plan), {
      snapshotBook: t.book,
      saveVersion: never,
    })
    await t.s.flush()
    expect(await undoRename(t.s, run)).toEqual({ restored: 2, kept: [] })
    await t.s.flush()
    expect(await Promise.all(t.ids.map((id) => t.text(id)))).toEqual(originals)
  })
})
