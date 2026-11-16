// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { sampleId } from '@/sample/ids'
import { scn, storyBook } from '../../tests/helpers/story-fixture'
import { choiceLines } from './scene-details'

describe('a scene’s choices as lines under its text', () => {
  const data = storyBook([
    {
      key: 'Start',
      choices: [
        ['Follow the lights', 'Chapel'],
        ['Ring the bell', sampleId('scn', 'gone')],
      ],
    },
    { key: 'Chapel', ending: true },
  ])

  it('say where each leads, by the number and title the story map uses', () => {
    expect(choiceLines(data, scn('Start'))[0]).toMatchObject({
      label: 'Follow the lights',
      to: '1.2 · Chapel',
    })
  })

  it('say nothing of where a choice goes when the scene is gone, and nothing for a scene with none', () => {
    expect(choiceLines(data, scn('Start'))[1]!.to).toBeUndefined()
    expect(choiceLines(data, scn('Chapel'))).toEqual([])
    expect(choiceLines(data, 'scn_0000000000')).toEqual([])
  })
})
