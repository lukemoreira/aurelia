// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, schemaVersion } from './common'

// aurelia.json
export const workspaceSchema = z.looseObject({
  schemaVersion,
  id: idOf('wsp'),
  name: z.string(),
  universes: z.array(idOf('unv')),
})

export type Workspace = z.infer<typeof workspaceSchema>
