// SPDX-License-Identifier: AGPL-3.0-or-later

/** A scene break (`* * *`, `---`, `⁂`): a line of its own, and no words. */
const SCENE_BREAK = /^([*\-_])(?:\s*\1){2,}$|^⁂$/
/** What opens a line in Markdown without being a word: quote marks, a list marker, a heading's hashes, a callout's `[!note]`. */
const LINE_MARKER =
  /^(?:\s*>)*\s*(?:(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?(?:\[![\w-]+\]\s*)?/
/** A bit of Markdown with no letters of its own: an emphasis mark, a table's bar or rule. */
const SYMBOLS_ONLY = /^[*_~|:\-=]+$/

/** Words in a scene's text. Scene breaks and Markdown's own marks are not words. */
export function countWords(body: string): number {
  let n = 0
  for (const line of body.split('\n')) {
    if (SCENE_BREAK.test(line.trim())) continue
    for (const token of line.replace(LINE_MARKER, '').split(/\s+/))
      if (token && !SYMBOLS_ONLY.test(token)) n++
  }
  return n
}
