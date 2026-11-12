// SPDX-License-Identifier: AGPL-3.0-or-later
import { sampleId } from './ids'

export const wsp = sampleId('wsp', 'sample')
export const calendar = sampleId('cal', 'tidal-reckoning')

export const unv = {
  saltmarch: sampleId('unv', 'saltmarch'),
  winter: sampleId('unv', 'winter-1709'),
}
export const bok = {
  lantern: sampleId('bok', 'lantern-gate'),
  tidebound: sampleId('bok', 'tidebound'),
  saltash: sampleId('bok', 'salt-and-ash'),
  winter: sampleId('bok', 'long-winter-1709'),
}
export const chr = {
  elena: sampleId('chr', 'elena'),
  tomas: sampleId('chr', 'tomas'),
  mirela: sampleId('chr', 'mirela'),
  corin: sampleId('chr', 'corin'),
  lampBoy: sampleId('chr', 'lamp-boy'),
}
export const plc = {
  gate: sampleId('plc', 'lantern-gate'),
  customs: sampleId('plc', 'customs-house'),
}
export const arc = {
  debt: sampleId('arc', 'the-debt'),
  tide: sampleId('arc', 'rising-tide'),
  letters: sampleId('arc', 'the-letters'),
}

export const SAMPLE_START = { book: bok.lantern, scene: sampleId('scn', 'curfew-bells') }
