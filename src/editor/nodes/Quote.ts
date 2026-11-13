// SPDX-License-Identifier: AGPL-3.0-or-later
import Blockquote, { inputRegex } from '@tiptap/extension-blockquote'
import { wrappingInputRule } from '@tiptap/core'

/**
 * A quote. Typing `> ` beside a quote starts a new one, never joins the one above: a callout
 * typed under a quote must not take the quote's words into it.
 */
export const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: inputRegex, type: this.type, joinPredicate: () => false })]
  },
})
