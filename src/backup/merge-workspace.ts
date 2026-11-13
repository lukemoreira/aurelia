// SPDX-License-Identifier: AGPL-3.0-or-later
// Two devices changed `aurelia.json` (ADR-0012). When only its lists differ (the order of the universes, say) the
// lists are put together; any other difference is a real conflict, and the caller keeps both texts.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** `mine` with the items of `theirs` that it lacks added to each list, or null when anything but a list differs. */
export function mergeLists(mine: string, theirs: string): string | null {
  try {
    const a: unknown = JSON.parse(mine)
    const b: unknown = JSON.parse(theirs)
    if (!isObject(a) || !isObject(b)) return null
    const out: Record<string, unknown> = { ...a }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const [x, y] = [a[key], b[key]]
      if (Array.isArray(x) && Array.isArray(y))
        out[key] = [...x, ...y.filter((item) => !x.some((own) => same(own, item)))]
      else if (!same(x, y)) return null
    }
    return `${JSON.stringify(out, null, 2)}\n`
  } catch {
    return null
  }
}

/**
 * Files Aurelia derives from the others (M3a): a book's `OUTLINE.md`, and the `outline` cache inside its `book.json`.
 * They are not the author's text, so two versions of them are no conflict worth a copy: either will do, and the
 * device writes them again from the scenes' own frontmatter.
 */
export function derivedOnly(path: string, mine: string, theirs: string): boolean {
  if (/\/books\/bok_\w+\/OUTLINE\.md$/.test(path)) return true
  if (!/\/books\/bok_\w+\/book\.json$/.test(path)) return false
  try {
    const a: unknown = JSON.parse(mine)
    const b: unknown = JSON.parse(theirs)
    if (!isObject(a) || !isObject(b)) return false
    const [restA, restB] = [{ ...a }, { ...b }]
    delete restA.outline
    delete restB.outline
    return same(restA, restB)
  } catch {
    return false
  }
}
