// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest'
import { addRecord } from '@/storage/record-actions'
import { setDetails } from './outline-actions'
import { movePinOf, pinPlace, setMapPicture, unpinPlace } from './place-map-actions'
import { outlineRig } from '../../tests/helpers/outline-rig'

beforeEach(() => localStorage.clear())

async function open() {
  const rig = await outlineRig()
  const { session } = rig
  const unv = session.data.universes[0]!.id
  const make = (title: string, type: 'world' | 'place' = 'place') =>
    addRecord(session, { type, title, universeId: unv })
  const france = await make('France', 'world')
  const [paris, lyon, nice] = [await make('Paris'), await make('Lyon'), await make('Nice')]
  const read = async (id: string) => {
    await session.flush()
    return (await rig.adapter.read(session.pathOf(id)!))!.text
  }
  return { ...rig, session, france, paris, lyon, nice, read }
}

describe('saving pins', () => {
  it('works from the file as it is when its turn comes, so two quick saves and a change made meanwhile all stay', async () => {
    const { session, france, paris, lyon, nice, read } = await open()
    // Another writer's change is queued first; the saves made right behind it must start from it.
    const other = setDetails(session, france, { pins: [{ place: paris, x: 0.1, y: 0.1 }] })
    const a = pinPlace(session, france, lyon, 0.2, 0.2)
    const b = pinPlace(session, france, nice, 0.3, 0.3)
    await Promise.all([other, a, b])
    const text = await read(france)
    for (const place of [paris, lyon, nice]) expect(text).toContain(place)
  })

  it('writes back entries it could not read, and changes only the one it touches', async () => {
    const { session, france, paris, lyon, nice, read } = await open()
    const odd = { kind: 'route', from: 1, to: 2 } // a kind of pin a later version wrote
    await setDetails(session, france, {
      pins: [
        odd,
        { place: paris, x: 0.123456, y: 0.7 }, // stored with more places than we write
        { place: 'nonsense', x: 0.5, y: 0.5 },
        { place: lyon, x: 0.3, y: 0.3 },
        { place: lyon, x: 0.9, y: 0.9 }, // a second pin of one place
      ],
    })
    await movePinOf(session, france, lyon, 0.5, 0.5)
    const moved = await read(france)
    expect(moved).toContain('kind: "route"')
    expect(moved).toContain('place: "nonsense"')
    expect(moved).toContain('x: 0.123456')
    expect(moved).toContain(`{ place: "${lyon}", x: 0.9, y: 0.9 }`)
    expect(moved).toContain(`{ place: "${lyon}", x: 0.5, y: 0.5 }`)
    await pinPlace(session, france, nice, 0.4, 0.4)
    expect(await read(france)).toContain('place: "nonsense"')
    await unpinPlace(session, france, paris)
    const after = await read(france)
    expect(after).not.toContain(paris)
    expect(after).toContain('kind: "route"')
  })

  it('replaces a pins value that is not a list, and takes the key away when nothing is left', async () => {
    const { session, france, paris, read } = await open()
    await setDetails(session, france, { pins: 'here' })
    await pinPlace(session, france, paris, 0.5, 0.5)
    expect(await read(france)).toContain(`place: "${paris}"`)
    await unpinPlace(session, france, paris)
    expect(await read(france)).not.toContain('pins')
  })

  it('takes the pins away with the map, and keeps them when only the picture changes', async () => {
    const { session, france, paris, read } = await open()
    await pinPlace(session, france, paris, 0.5, 0.5)
    await setMapPicture(session, france, 'med_aaaaaaaaaa')
    expect(await read(france)).toContain('pins:')
    await setMapPicture(session, france, undefined)
    const text = await read(france)
    expect(text).not.toContain('pins')
    expect(text).not.toContain('map:')
  })

  it('is not a save when the file changed elsewhere and is left in conflict: it says so', async () => {
    const { session, adapter, france, paris } = await open()
    await session.flush()
    const path = session.pathOf(france)!
    const disk = (await adapter.read(path))!.text
    await adapter.write(path, `${disk}\nChanged by another app.\n`) // behind Aurelia's back
    await expect(pinPlace(session, france, paris, 0.5, 0.5)).rejects.toThrow('could not save')
  })
})
