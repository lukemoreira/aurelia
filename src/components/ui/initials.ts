// SPDX-License-Identifier: AGPL-3.0-or-later
/** "Elena Vasquez" → "EV"; one word → its first letter. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
  return letters
    .map((w) => (w ? Array.from(w)[0] : ''))
    .join('')
    .toUpperCase()
}
