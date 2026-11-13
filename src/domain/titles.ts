// SPDX-License-Identifier: AGPL-3.0-or-later

export const MAX_TITLE = 200

/** The one check for a title of a book, chapter, scene, part or record: trimmed, not empty, not long, no hidden characters. */
export function checkTitle(raw: string): { title: string; error: string; ok: boolean } {
  const title = raw.trim()
  const error =
    title.length > MAX_TITLE
      ? `Keep the name under ${MAX_TITLE} letters.`
      : /\p{Cc}/u.test(title)
        ? 'Take out the line breaks and other hidden characters.'
        : ''
  return { title, error, ok: title.length > 0 && !error }
}
