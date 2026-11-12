// SPDX-License-Identifier: AGPL-3.0-or-later

/** Scenes are plain paragraphs separated by a blank line; a line of `* * *` is a scene break. */
export const CURFEW_BELLS = [
  'The bells had already begun when Elena reached the Lantern Gate. Nine strokes for curfew, the old count, as if the city still believed the sea could be bargained with.',
  'She kept her hood low. A boy on a ladder lit the lamps along the arch one by one, and each new flame showed a little more of the warden’s face: square, patient, entirely unsurprised.',
  'Tomas Brandt did not reach for the ledger. He reached for the lantern instead, and lifted it until the light fell across her cheek.',
  '“You were drowned, the last I heard,” he said.',
  '“The sea changed its mind.”',
  'He let the silence stand long enough that the boy on the ladder stopped to listen. Then he set the lantern down on the ledger, over the open page, as if to keep it from blowing away.',
  '* * *',
  'Inside the gate the Lantern Quarter smelled of tar and wet rope. Elena counted her steps the way her mother had taught her — forty to the well, twelve to the chandler’s door — and did not let herself look back until she had counted them all.',
].join('\n\n')

/** A short stand-in for every other scene in the sample. */
export const placeholder = (summary: string) =>
  `${summary}\n\nThe rest of this scene is still to be written.`
