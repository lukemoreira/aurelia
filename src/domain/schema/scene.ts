// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, orderKey, progressStatus, schemaVersion, storyTime } from './common'

// ADR-0006: unknown kinds are kept, so `kind` is a plain string.
const changeSchema = z.looseObject({
  kind: z.string(),
  who: idOf().optional(),
  with: idOf().optional(),
  item: idOf('itm').optional(),
  id: idOf('stp').optional(),
  of: idOf('stp').optional(),
  value: z.string().optional(),
})

// ADR-0004: unknown keys on a choice are kept (variables and effects come later).
const choiceSchema = z.looseObject({
  id: idOf('chc'),
  label: z.string(),
  target: idOf('scn'),
  note: z.string().optional(),
})

// scenes/scn_….md frontmatter
export const sceneSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('scn'),
  chapter: idOf('chp'),
  order: orderKey,
  status: progressStatus.optional(),
  summary: z.string().optional(),
  pov: idOf('chr').optional(),
  location: idOf('plc').optional(),
  time: storyTime.optional(),
  objective: z.string().optional(),
  conflict: z.string().optional(),
  outcome: z.string().optional(),
  characters: z
    .looseObject({ add: z.array(idOf('chr')).optional(), remove: z.array(idOf('chr')).optional() })
    .optional(),
  arcs: z.array(idOf('arc')).optional(),
  target: z.number().int().nonnegative().optional(),
  flashback: z.boolean().optional(),
  ending: z.boolean().optional(),
  changes: z.array(changeSchema).optional(),
  choices: z.array(choiceSchema).optional(),
})

export type Scene = z.infer<typeof sceneSchema>
