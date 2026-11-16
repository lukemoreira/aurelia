// SPDX-License-Identifier: AGPL-3.0-or-later
import { Extension } from '@tiptap/core'
import type { LinkEnv } from './link-env'
import { linkPickerPlugin } from './link-picker'
import { linksPlugin } from './links-plugin'

/**
 * Links, embeds and names over the manuscript, and the picker that opens on `[[`. Everything is
 * drawn or offered; nothing is written until the author chooses (the text stays what the Markdown
 * converter keeps, ADR-0007). One per editor: the environment is that screen's.
 */
export const createLinks = (env: LinkEnv) =>
  Extension.create({
    name: 'aureliaLinks',
    // Before the editor's own Enter and Tab: with the picker open they choose a match.
    priority: 1000,
    addProseMirrorPlugins: () => [linksPlugin(env), linkPickerPlugin(env)],
  })

export { focusFound, focusName, refreshLinks } from './links-plugin'
export { chooseLink, optionId, PICKER_ID } from './link-picker'
