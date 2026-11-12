// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { saltmarchSample, SAMPLE_START } from '@/sample/saltmarch'
import { sceneDetails } from './scene-details'

const data = saltmarchSample()

describe('sceneDetails', () => {
  const d = sceneDetails(data, SAMPLE_START.scene)!

  it('resolves the fields the inspector shows', () => {
    expect(d).toMatchObject({
      label: '7.2',
      status: 'draft',
      location: 'The Lantern Gate',
      storyTime: '14 Thaw 412 TR · Dusk',
      words: 1240,
      target: 1800,
    })
    expect(d.pov).toMatchObject({ name: 'Elena Vasquez', color: 'ember', pov: true })
    expect(d.arcs.map((a) => a.name)).toEqual(['The Debt', 'Rising Tide'])
  })

  it('lists who is in the scene, marking the POV and book-only people', () => {
    expect(d.people.map((p) => [p.name, p.pov, p.bookOnly])).toEqual([
      ['Elena Vasquez', true, false],
      ['Tomas Brandt', false, false],
      ['Lamp boy', false, true],
    ])
  })

  it('writes changes in plain words', () => {
    expect(d.changes).toEqual([
      { kind: 'Relationship', text: 'Tomas Brandt → Elena Vasquez: stranger → creditor' },
      { kind: 'Set-up', text: 'Elena owes the warden a favour' },
      { kind: 'Learns', text: 'Tomas Brandt: Elena is alive' },
    ])
  })

  it('shows an unknown change kind as "Change", never its raw name', () => {
    const copy = saltmarchSample()
    const scene = copy.scenes.find((s) => s.meta.id === SAMPLE_START.scene)!
    scene.meta = { ...scene.meta, changes: [{ kind: 'teleports', value: 'x' }] }
    expect(sceneDetails(copy, SAMPLE_START.scene)!.changes[0]!.kind).toBe('Change')
  })

  it('lists a branching scene’s choices and nothing for a plain one', () => {
    const ashore = data.scenes.find((s) => s.meta.title === 'Washed Ashore')!
    expect(sceneDetails(data, ashore.meta.id)!.choices).toEqual([
      'Follow the lights',
      'Hide in the wreck',
    ])
    expect(d.choices).toEqual([])
  })

  it('is undefined for an unknown scene', () => {
    expect(sceneDetails(data, 'scn_zzzzzzzzzz')).toBeUndefined()
  })
})
