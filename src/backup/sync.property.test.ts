// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { davFetch } from '../../tests/helpers/fake-dav'
import { syncWorld, type SimDevice } from '../../tests/helpers/sync-rig'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { fetchBackup } from './restore'

// Random edits, creates, deletes (one and most of a workspace), moves, a server that loses its files, offline periods and
// rounds on 2 and 3 devices, in a random order, against the in-memory WebDAV (ADR-0012). Every device is the real stack:
// session, save pipeline, sync engine, WebDAV client. Rounds of different devices overlap (each request waits a random
// moment), and a device types between the moment a round reads its files and the moment it applies what came, saved
// or not. A failure prints its seed: `SYNC_SEED=<n> npx vitest run src/backup/sync.property.test.ts` replays it (the
// overlapping rounds make a replay approximate).

const SEEDS = Number(process.env.SYNC_SEEDS ?? 80)
const STEPS = 44
/** What the runs did, so a green run proves the interesting cases happened. */
const seen = {
  runs: 0,
  conflictCopies: 0,
  deletes: 0,
  bulkDeletes: 0,
  volumeLosses: 0,
  resurrected: 0,
  offlineRounds: 0,
  moves: 0,
  typedMidRound: 0,
  typedUnsavedMidRound: 0,
  pendingConflicts: 0,
  overlappingRounds: 0,
}

function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const tokensOf = (text: string) => new Set([...text.matchAll(/\(w(\d+)\)/g)].map((m) => m[1]!))

/**
 * `chaos`: rounds overlap and words are typed between a round's read and its apply. Then "a deleted file does not come
 * back" is not asked, since a delete racing an edit may be won by the edit. In the calm runs (rounds one at a time) it
 * is, and the server also loses its files once in a while, at a moment when the devices are in step.
 */
async function run(seed: number, devices: number, chaos: boolean) {
  const rnd = random(seed)
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const world = await syncWorld('Chrome on macOS', {
    jitter: chaos ? () => (rnd() < 0.2 ? 1 : 0) : undefined,
  })
  try {
    for (let i = 1; i < devices; i++) await world.join(`Device ${i + 1}`)
    const written = new Set<string>()
    const forgiven = new Map<string, Set<string>>() // path → tokens a device deleted with it
    let n = 0
    let volumeLost = false
    const sceneOf = new Map<string, string>() // token → the scene it was typed in
    const log: string[] = []

    const sceneFiles = async (d: SimDevice) =>
      (await d.adapter.list()).filter((p) =>
        /\/scenes\/scn_\w+(?: \(Aurelia copy [0-9a-f]{8}\))?\.md$/.test(p),
      )
    const type = async (d: SimDevice, save: boolean) => {
      const scene = pick(d.session.data.scenes)
      if (!scene) return false
      const token = String(++n)
      written.add(token)
      sceneOf.set(token, scene.meta.id)
      log.push(`  ${d.name} types w${token} (save=${save}) in ${scene.meta.id}`)
      await d.session.editScene(scene.meta.id, `${scene.body} (w${token})`)
      if (save) await d.session.flush()
      return true
    }
    const remove = async (d: SimDevice, path: string) => {
      const text = (await d.adapter.read(path))?.text ?? ''
      const set = forgiven.get(path) ?? new Set<string>()
      for (const t of tokensOf(text)) set.add(t)
      forgiven.set(path, set)
      log.push(`  ${d.name} deletes ${path.slice(-18)} with ${[...tokensOf(text)].join(',')}`)
      await d.adapter.remove(path)
    }
    const resolveConflicts = async (d: SimDevice) => {
      for (const c of d.session.view().conflicts) {
        seen.pendingConflicts++
        await d.session
          .resolveConflict(c.path, rnd() < 0.5 ? 'mine' : 'theirs')
          .catch(() => undefined)
      }
    }

    // Words typed between the moment a round reads the files and the moment it applies what it fetched.
    for (const d of chaos ? world.devices : [])
      d.beforeRequest = async (method, path) => {
        if (method !== 'GET' || !path.includes('/current/') || rnd() >= 0.15) return
        const save = rnd() < 0.5
        if (await type(d, save)) {
          seen.typedMidRound++
          if (!save) seen.typedUnsavedMidRound++
        }
      }

    // Rounds, one device after another, until nothing changes any more.
    const snapshot = async () =>
      JSON.stringify(await Promise.all(world.devices.map(async (d) => [...(await d.files())])))
    const quiesce = async () => {
      let last = ''
      let quiet = 0
      for (let pass = 0; pass < 14 && quiet < 2; pass++) {
        for (const d of world.devices) await resolveConflicts(d)
        for (const d of world.devices) await d.round()
        const now = await snapshot()
        quiet = now === last ? quiet + 1 : 0
        last = now
      }
    }

    const inFlight: Promise<unknown>[] = []
    const settleRounds = async () => void (await Promise.all(inFlight.splice(0)))
    for (let step = 0; step < STEPS; step++) {
      const d = pick(world.devices)!
      const r = rnd()
      log.push(
        `${step}: ${d.name} r=${r.toFixed(2)} online=${world.devices.map((x) => (x.online ? 1 : 0)).join('')}`,
      )
      if (r < 0.28) {
        await type(d, rnd() < 0.7)
      } else if (r < 0.33) {
        const chapter = d.session.data.chapters[0]
        if (chapter) await d.session.createScene(chapter.id).catch(() => undefined)
      } else if (r < 0.37) {
        const chapter = d.session.data.chapters[0]
        if (chapter)
          for (let i = 0; i < 5; i++) await d.session.createScene(chapter.id).catch(() => undefined)
      } else if (r < 0.42) {
        await d.session.flush()
        const path = pick(await sceneFiles(d))
        if (!path) continue
        await remove(d, path)
        seen.deletes++
        await d.session.checkAll()
      } else if (r < 0.46) {
        // Most of the workspace, on purpose.
        await d.session.flush()
        const files = await sceneFiles(d)
        if (files.length < 5) continue
        for (const path of files.slice(0, -1)) await remove(d, path)
        seen.bulkDeletes++
        await d.session.checkAll()
      } else if (r < 0.49) {
        await d.session.flush()
        const path = pick(await sceneFiles(d))
        if (!path) continue
        const text = (await d.adapter.read(path))?.text
        if (text === undefined) continue
        await d.adapter.write(`archive/moved-${++n}.md`, text)
        await d.adapter.remove(path)
        seen.moves++
        await d.session.checkAll()
      } else if (r < 0.5 && !chaos && seed % 3 === 0 && !volumeLost) {
        // The server loses its files (a volume that came back empty), at a time when the devices are in step.
        await settleRounds()
        for (const x of world.devices) x.online = true
        await quiesce()
        for (const p of world.dav.paths(`${world.folder}/current/`)) world.dav.files.delete(p)
        volumeLost = true
        seen.volumeLosses++
      } else if (r < 0.58) d.online = !d.online
      else if (r < 0.61) await resolveConflicts(d)
      else if (chaos && r < 0.8) {
        // Every online device at once.
        const online = world.devices.filter((x) => x.online)
        if (online.length > 1) seen.overlappingRounds++
        inFlight.push(...online.map((x) => x.round().catch(() => undefined)))
        if (rnd() < 0.6) await settleRounds()
      } else if (d.online) {
        inFlight.push(d.round().catch(() => undefined))
        if (!chaos || rnd() < 0.5) await settleRounds()
      } else seen.offlineRounds++
      world.advance(1000)
    }
    await settleRounds()

    // Everyone comes back online, the author settles what is in question, and the rounds run until nothing changes.
    for (const d of world.devices) {
      d.online = true
      d.beforeRequest = undefined
    }
    await quiesce()

    // 1. Everyone has the same files, and they are the server's.
    const [first, ...rest] = await Promise.all(world.devices.map((d) => d.files()))
    for (const other of rest) expect([...other]).toEqual([...first!])
    const server = world.dav
      .paths(`${world.folder}/current/`)
      .map((p) => p.slice(world.folder.length + 9))
    expect(server).toEqual([...first!.keys()].sort())
    for (const [path, text] of first!)
      expect(world.dav.text(`${world.folder}/current/${path}`)).toBe(text)
    for (const d of world.devices) expect(d.session.view().conflicts).toEqual([])

    seen.runs++
    seen.conflictCopies += [...first!.keys()].filter((p) => /\(Aurelia copy /.test(p)).length

    // 2. No word was lost: every word written is in some file now, unless the file it was in was deleted on purpose.
    const final = new Set<string>()
    for (const text of first!.values()) for (const t of tokensOf(text)) final.add(t)
    const deletedTokens = new Set([...forgiven.values()].flatMap((s) => [...s]))
    const lost = [...written].filter((t) => !final.has(t) && !deletedTokens.has(t))
    expect(
      lost,
      `words that disappeared\n${log.join('\n')}\n${world.trace.filter((l) => lost.some((t) => l.includes(sceneOf.get(t)!.slice(-8))) && !l.includes('PROPFIND')).join('\n')}`,
    ).toEqual([])

    // 3. A deleted file does not come back by itself: if it is there, someone wrote something new in it. (A server
    // that lost its files has lost what was deleted too: what the devices still hold goes up again.)
    if (!chaos && !volumeLost)
      for (const [path, gone] of forgiven) {
        const text = first!.get(path)
        // (A copy is named by its text: the same two texts meeting again make the same copy.)
        if (text === undefined || /\(Aurelia copy /.test(path)) continue
        seen.resurrected++
        const fresh = [...tokensOf(text)].filter((t) => !gone.has(t))
        expect(
          fresh.length,
          `${path} came back with only what was deleted\n${log.join('\n')}\n${world.dav.log.filter((l) => l.includes(path.slice(-18)) && !l.startsWith('PROPFIND')).join('\n')}\nforgiven ${[...gone].join(',')} tokens ${[...tokensOf(text)].join(',')}`,
        ).toBeGreaterThan(0)
      }

    // 4. Nothing was written to the shared copy without If-Match or If-None-Match.
    expect(world.dav.unconditional.filter((l) => l.includes('/current/'))).toEqual([])

    // 5. A restore of what the devices agreed on passes its hash check.
    const fetched = await fetchBackup(
      new WebDavStore('/dav/', davFetch(world.dav)),
      world.folder,
      'current',
    )
    expect(fetched.problems).toEqual([])
  } finally {
    world.dispose()
  }
}

const only = process.env.SYNC_SEED ? [Number(process.env.SYNC_SEED)] : undefined
const seeds = only ?? Array.from({ length: SEEDS }, (_, i) => i + 1)

describe.each([
  [2, false],
  [3, false],
  [2, true],
  [3, true],
])('random edits on %i devices (chaos: %s)', (devices, chaos) => {
  it.each(seeds)(
    'seed %i: no word is lost, devices converge, nothing silently returns',
    async (seed) => {
      await run(seed * 100 + devices, devices, chaos)
    },
    60_000,
  )
})

it('the random runs met conflicts, single and bulk deletes, lost volumes, words typed mid-round (saved and not), unsaved edits met by a pull, and overlapping rounds', () => {
  if (only) return
  expect(seen.runs).toBe(4 * SEEDS)
  expect(seen.conflictCopies).toBeGreaterThan(SEEDS / 2)
  expect(seen.deletes).toBeGreaterThan(SEEDS)
  expect(seen.bulkDeletes).toBeGreaterThan(SEEDS / 10)
  expect(seen.volumeLosses).toBeGreaterThan(SEEDS / 10)
  expect(seen.moves).toBeGreaterThan(SEEDS / 2)
  expect(seen.offlineRounds).toBeGreaterThan(SEEDS)
  expect(seen.resurrected).toBeGreaterThan(0)
  expect(seen.typedMidRound).toBeGreaterThan(SEEDS)
  expect(seen.typedUnsavedMidRound).toBeGreaterThan(SEEDS / 2)
  expect(seen.pendingConflicts).toBeGreaterThan(0)
  expect(seen.overlappingRounds).toBeGreaterThan(SEEDS)
})
