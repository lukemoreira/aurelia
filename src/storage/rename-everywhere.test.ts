// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { certainPlaces, planRename, proposeForms } from '@/index/rename'
import { WorkspaceIndex } from '@/index/workspace-index'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { addIgnoredNames } from './names-actions'
import { renameItem } from './outline-actions'
import { addRecord } from './record-actions'
import { applyRename, undoRename } from './rename-everywhere'

const OLD = { title: 'Elena Vasquez', aliases: [{ text: 'Elena' }, { text: 'Lena' }] }

/** A workspace with Elena, three scenes and a note that name her, already renamed to Helena Vasquez. */
async function rig() {
  const r = await outlineRig()
  const s = r.session
  const universeId = s.data.universes[0]!.id
  const chapter = s.data.chapters[0]!.id
  const first = s.data.scenes[0]!.meta.id
  const elena = await addRecord(s, { type: 'character', title: OLD.title, universeId })
  const note = await addRecord(s, { type: 'research', title: 'Plan', universeId })
  const second = await s.createScene(chapter)
  const third = await s.createScene(chapter)
  const bodies = {
    [first]:
      'Elena Vasquez met Elena’s brother at the gate.\n\nElenath and elena@example.com stay.\n',
    [second]: 'She said [[Elena Vasquez|Elena]] was late. Lena nodded.\n',
    [third]: 'Nothing about her here.\n',
  }
  for (const [id, body] of Object.entries(bodies)) await s.editScene(id, body)
  await s.editNotes(note, 'Elena leaves in chapter two.\n')
  await s.setFields(elena, { aliases: OLD.aliases })
  await s.flush()
  await renameItem(s, elena, 'Helena Vasquez')
  await s.flush()
  const plan = () => {
    const index = new WorkspaceIndex()
    index.sync(s.data)
    return planRename(index, elena, OLD, proposeForms(OLD.title, 'Helena Vasquez', OLD.aliases))
  }
  const text = async (id: string) => (await r.adapter.read(s.pathOf(id)!))!.text
  const events: string[] = []
  r.adapter.beforeWrite = (path) => void events.push(`write ${path}`)
  return { ...r, s, elena, note, ids: { first, second, third }, plan, text, events }
}

const never = () => Promise.resolve(false)

describe('rename everywhere: writing it', () => {
  it('changes Elena and not Elenath or the address, in the scenes and the notes, and only the text of those files', async () => {
    const t = await rig()
    const before = await snapshot(t.adapter)
    const plan = t.plan()
    expect(changes(before, await snapshot(t.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    }) // looking writes nothing
    await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      aliases: { before: OLD.aliases, after: [{ text: 'Helena' }, { text: 'Lena' }] },
      saveVersion: never,
    })
    await t.s.flush()
    expect(await t.text(t.ids.first)).toContain(
      'Helena Vasquez met Helena’s brother at the gate.\n\nElenath and elena@example.com stay.\n',
    )
    expect(await t.text(t.ids.second)).toContain(
      'She said [[Helena Vasquez|Helena]] was late. Lena nodded.',
    )
    expect(await t.text(t.note)).toContain('Helena leaves in chapter two.')
    const diff = changes(before, await snapshot(t.adapter))
    expect(diff.changed.map((p) => p.replace(/^.*\//, '')).sort()).toEqual(
      [t.ids.first, t.ids.second, t.note, t.elena].map((i) => `${i}.md`).sort(),
    )
    // The scene nobody named Elena in is the file it was.
    expect(diff.changed.some((p) => p.includes(t.ids.third))).toBe(false)
    // Her other names follow, so the new names are found from now on.
    expect(t.s.data.records.find((r) => r.meta.id === t.elena)!.meta.aliases).toEqual([
      { text: 'Helena' },
      { text: 'Lena' },
    ])
  })

  it('leaves the details at the top of every file byte for byte', async () => {
    const t = await rig()
    const head = async (id: string) => (await t.text(id)).split('\n---\n')[0]
    const heads = await Promise.all(Object.values(t.ids).map(head))
    const plan = t.plan()
    await applyRename(t.s, plan, certainPlaces(plan), { recordId: t.elena, saveVersion: never })
    await t.s.flush()
    expect(await Promise.all(Object.values(t.ids).map(head))).toEqual(heads)
  })

  it('saves a version first when backup is on, and still keeps a copy of each file', async () => {
    const t = await rig()
    const plan = t.plan()
    t.events.length = 0
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      saveVersion: async () => (t.events.push('version'), true),
    })
    expect(run.versioned).toBe(true)
    expect(t.events[0]).toBe('version')
    // A version that did not reach the server is not a promise: the copies are always made.
    expect(t.events.filter((e) => e.includes('.aurelia/safety'))).toHaveLength(3)
  })

  it('asks for the version before it compares, so a change that version brings in is seen', async () => {
    const t = await rig()
    const plan = t.plan()
    const before = await snapshot(t.adapter)
    await expect(
      applyRename(t.s, plan, certainPlaces(plan), {
        recordId: t.elena,
        // In sync mode the version is a sync round: another device's words land here.
        saveVersion: async () => (
          await t.s.editScene(t.ids.second, 'Another device wrote this.\n'),
          true
        ),
      }),
    ).rejects.toThrow(/changed since the places were found/)
    await t.s.flush()
    expect(await t.text(t.ids.second)).toContain('Another device wrote this.')
    expect((await snapshot(t.adapter)).get(t.s.pathOf(t.ids.first)!)).toBe(
      before.get(t.s.pathOf(t.ids.first)!),
    )
  })

  it('compares each file again just before writing it, and stops rather than write over what landed', async () => {
    const t = await rig()
    const plan = t.plan()
    let once = true
    // After the compare, during the copies: words land in the second scene.
    t.adapter.beforeWrite = async (path) => {
      if (once && path.includes('.aurelia/safety')) {
        once = false
        await t.s.editScene(t.ids.second, 'Typed in the meantime.\n')
      }
    }
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      saveVersion: never,
    })
    await t.s.flush()
    expect(run.stopped).toMatchObject({ why: 'changed' })
    expect(await t.text(t.ids.second)).toContain('Typed in the meantime.')
    expect(run.done).toBe(1)
  })

  it('does not take a change from another device while it runs: it is offered again later', async () => {
    const t = await rig()
    const plan = t.plan()
    let answer: Map<string, string> | undefined
    const base = await t.text(t.ids.third)
    // A change that would apply (the file on disk is what the sender saw), if nothing were running.
    const remote = () => ({
      path: t.s.pathOf(t.ids.third)!,
      text: `${base}Remote.\n`,
      expect: t.s.pipeline.known.get(t.s.pathOf(t.ids.third)!) ?? null,
    })
    t.adapter.beforeWrite = async (path) => {
      if (!answer && path.includes('.aurelia/safety')) {
        answer = await t.s.applyRemote([remote()])
      }
    }
    await applyRename(t.s, plan, certainPlaces(plan), { recordId: t.elena, saveVersion: never })
    expect([...answer!.values()]).toEqual(['deferred'])
    t.adapter.beforeWrite = undefined
    const later = await t.s.applyRemote([remote()])
    expect([...later.values()]).toEqual(['applied'])
    expect(await t.text(t.ids.third)).toContain('Remote.')
  })

  it('refuses while a file still has words it could not save', async () => {
    const t = await rig()
    const plan = t.plan()
    const original = t.s.data.scenes.find((x) => x.meta.id === t.ids.first)!.body
    await t.s.editScene(t.ids.first, 'x')
    await t.s.editScene(t.ids.first, original) // the text is the one the places were found in…
    const path = t.s.pathOf(t.ids.first)!
    t.adapter.beforeWrite = (p) => {
      if (p === path) throw new Error('disk full') // …but it cannot reach its file
    }
    await expect(
      applyRename(t.s, plan, certainPlaces(plan), { recordId: t.elena, saveVersion: never }),
    ).rejects.toThrow(/still saving/)
    t.adapter.beforeWrite = undefined
  })

  it('keeps a copy of every file it changes, first, when there is no backup', async () => {
    const t = await rig()
    const plan = t.plan()
    const old = await t.text(t.ids.first)
    t.events.length = 0
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      saveVersion: never,
    })
    expect(run.versioned).toBe(false)
    const copies = (await t.adapter.list()).filter((p) => p.startsWith('.aurelia/safety/'))
    expect(copies).toHaveLength(3) // two scenes and the notes
    const mine = copies.find((p) => p.endsWith(`${t.ids.first}.md`))!
    expect((await t.adapter.read(mine))!.text).toBe(old)
    // Every copy is made before the first file is changed.
    const firstChange = t.events.findIndex((e) => !e.includes('.aurelia/safety'))
    expect(
      t.events.slice(0, firstChange).filter((e) => e.includes('.aurelia/safety')),
    ).toHaveLength(3)
  })

  it('changes only the places that were ticked', async () => {
    const t = await rig()
    const plan = t.plan()
    const one = plan.places.find((p) => p.docId === t.ids.second && p.old === 'Elena')!
    await applyRename(t.s, plan, new Set([one.key]), { recordId: t.elena, saveVersion: never })
    await t.s.flush()
    expect(await t.text(t.ids.second)).toContain('[[Elena Vasquez|Helena]]')
    expect(await t.text(t.ids.first)).toContain('Elena Vasquez met Elena’s brother')
  })

  it('refuses everything, before writing, when a file was typed in since the places were found', async () => {
    const t = await rig()
    const plan = t.plan()
    await t.s.editScene(t.ids.second, 'Someone typed in this.\n')
    await t.s.flush()
    const before = await snapshot(t.adapter)
    await expect(
      applyRename(t.s, plan, certainPlaces(plan), { recordId: t.elena, saveVersion: never }),
    ).rejects.toThrow(/changed since the places were found/)
    expect(changes(before, await snapshot(t.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('stops at a file another app changed, says how far it got, and undo puts back what it did', async () => {
    const t = await rig()
    const plan = t.plan()
    const originals = new Map<string, string>()
    for (const id of [t.ids.first, t.ids.second, t.note]) originals.set(id, await t.text(id))
    // Another app edits the second scene's file after Aurelia read it: compare-and-write must not overwrite it.
    const path = t.s.pathOf(t.ids.second)!
    await t.adapter.write(path, `${originals.get(t.ids.second)!}Added by another app.\n`)
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      saveVersion: never,
    })
    expect(run.stopped).toEqual({ title: expect.any(String), why: 'save' })
    expect(run.done).toBe(1)
    // The file it stopped in is recorded too, and is not left renamed on screen.
    expect(run.files.map((f) => f.id)).toEqual([t.ids.first, t.ids.second])
    expect(t.s.data.scenes.find((x) => x.meta.id === t.ids.second)!.body).toBe(
      originals.get(t.ids.second)!.split('\n---\n')[1]!.replace(/^\n+/, ''),
    )
    expect(await t.text(t.ids.second)).toContain('Added by another app.')
    expect(await t.text(t.ids.second)).toContain('[[Elena Vasquez|Elena]]') // not changed
    expect(await t.text(t.note)).toContain('Elena leaves') // nor the ones after it

    const undone = await undoRename(t.s, run)
    await t.s.flush()
    expect(undone).toEqual({ restored: 1, kept: [] })
    expect(await t.text(t.ids.first)).toBe(originals.get(t.ids.first))
  })

  it('one undo puts every file and the other names back, byte for byte', async () => {
    const t = await rig()
    const plan = t.plan()
    const ids = [t.ids.first, t.ids.second, t.note, t.elena]
    const originals = await Promise.all(ids.map((id) => t.text(id)))
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      aliases: { before: OLD.aliases, after: [{ text: 'Helena' }, { text: 'Lena' }] },
      saveVersion: never,
    })
    await t.s.flush()
    expect(await t.text(t.ids.first)).not.toBe(originals[0])
    const undone = await undoRename(t.s, run)
    await t.s.flush()
    expect(undone.restored).toBe(3)
    expect(await Promise.all(ids.map((id) => t.text(id)))).toEqual(originals)
  })

  it('leaves the other names alone when they were edited since, and says so', async () => {
    const t = await rig()
    const plan = t.plan()
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      aliases: { before: OLD.aliases, after: [{ text: 'Helena' }, { text: 'Lena' }] },
      saveVersion: never,
    })
    await t.s.setFields(t.elena, {
      aliases: [{ text: 'Helena' }, { text: 'Lena' }, { text: 'Nell' }],
    })
    await t.s.flush()
    const undone = await undoRename(t.s, run)
    expect(undone.kept).toEqual(['Helena Vasquez'])
    expect(t.s.data.records.find((r) => r.meta.id === t.elena)!.meta.aliases).toHaveLength(3)
  })

  it('does not undo over words typed since, and names the file it left', async () => {
    const t = await rig()
    const plan = t.plan()
    const run = await applyRename(t.s, plan, certainPlaces(plan), {
      recordId: t.elena,
      saveVersion: never,
    })
    await t.s.editScene(t.ids.first, 'Helena wrote something new.\n')
    await t.s.flush()
    const undone = await undoRename(t.s, run)
    await t.s.flush()
    expect(undone.restored).toBe(2)
    expect(undone.kept).toHaveLength(1)
    expect(await t.text(t.ids.first)).toContain('Helena wrote something new.')
  })
})

describe('"not a name": writing it', () => {
  it('adds the key to the scene’s details, once, and touches nothing else in the file', async () => {
    const t = await rig()
    const before = await t.text(t.ids.first)
    await addIgnoredNames(t.s, t.ids.first, ['Will:2'])
    await addIgnoredNames(t.s, t.ids.first, ['Will:2', 'Will:3'])
    await t.s.flush()
    const after = await t.text(t.ids.first)
    expect(after).toContain('ignoreNames:\n  - "Will:2"\n  - "Will:3"\n')
    expect(after.replace(/ignoreNames:\n( {2}- .*\n)+/, '')).toBe(before)
    expect(t.s.data.scenes.find((x) => x.meta.id === t.ids.first)!.meta.ignoreNames).toEqual([
      'Will:2',
      'Will:3',
    ])
  })
})
