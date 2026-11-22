// SPDX-License-Identifier: AGPL-3.0-or-later
// A word-by-word comparison of two texts (ADR-0013). Plain TypeScript, no Vue, no dependency.
// Words are what is compared; the spaces and line breaks before a word travel with it, so a
// space alone never "matches" and splits a changed phrase into pieces.

export interface DiffPart {
  kind: 'same' | 'added' | 'removed'
  text: string
}

type Edit = DiffPart['kind']

/** The most single-word edits looked for. Past it the middle is shown as all removed, then all added: still true, only coarser. */
export const MAX_EDITS = 1500

interface Words {
  words: string[]
  /** The spaces before each word. */
  gaps: string[]
  /** The spaces after the last word. */
  tail: string
}

function split(text: string): Words {
  const out: Words = { words: [], gaps: [], tail: '' }
  let end = 0
  for (const m of text.matchAll(/(\s*)(\S+)/g)) {
    out.gaps.push(m[1]!)
    out.words.push(m[2]!)
    end = m.index + m[0].length
  }
  out.tail = text.slice(end)
  return out
}

/** Myers' O(ND) shortest edit script over two word lists: one edit per word; null when it needs more than `limit`. */
function edits(a: string[], b: string[], limit: number): Edit[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, limit)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[k - 1 + off]! < v[k + 1 + off]!)
          ? v[k + 1 + off]!
          : v[k - 1 + off]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + off] = x
      if (x >= n && y >= m) return backtrack(n, m, trace, d, off)
    }
  }
  return null
}

function backtrack(n: number, m: number, trace: Int32Array[], end: number, off: number): Edit[] {
  const out: Edit[] = []
  let x = n
  let y = m
  for (let d = end; d > 0; d--) {
    const v = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && v[k - 1 + off]! < v[k + 1 + off]!) ? k + 1 : k - 1
    const prevX = v[prevK + off]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push('same')
      x--
      y--
    }
    out.push(x === prevX ? 'added' : 'removed')
    if (x === prevX) y--
    else x--
  }
  while (x > 0 && y > 0) {
    out.push('same')
    x--
    y--
  }
  return out.reverse()
}

/** Join neighbours of one kind, so a run of words is one piece of text. */
function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = []
  for (const p of parts) {
    if (!p.text) continue
    const last = out.at(-1)
    if (last?.kind === p.kind) last.text += p.text
    else out.push({ ...p })
  }
  return out
}

/**
 * What changed from `before` to `after`, in order: the `same` and `removed` pieces read back as
 * `before`, the `same` and `added` pieces as `after`. Words common to both are kept as long as
 * the shortest set of edits allows.
 */
export const diffWords = (before: string, after: string, limit = MAX_EDITS): DiffPart[] =>
  diffInfo(before, after, limit).parts

/** The same, and whether it is rough: past the edit limit the middle is whole-stretch removed and added, so word counts are about. */
export function diffInfo(
  before: string,
  after: string,
  limit = MAX_EDITS,
): { parts: DiffPart[]; rough: boolean } {
  if (before === after)
    return { parts: before ? [{ kind: 'same', text: before }] : [], rough: false }
  const [a, b] = [split(before), split(after)]
  let head = 0
  while (head < a.words.length && head < b.words.length && a.words[head] === b.words[head]) head++
  let tail = 0
  while (
    tail < a.words.length - head &&
    tail < b.words.length - head &&
    a.words.at(-1 - tail) === b.words.at(-1 - tail)
  )
    tail++
  const midA = a.words.slice(head, a.words.length - tail)
  const midB = b.words.slice(head, b.words.length - tail)
  const exact = edits(midA, midB, limit)
  const middle: Edit[] = exact ?? [
    ...midA.map((): Edit => 'removed'),
    ...midB.map((): Edit => 'added'),
  ]
  const script: Edit[] = [
    ...Array<Edit>(head).fill('same'),
    ...middle,
    ...Array<Edit>(tail).fill('same'),
  ]

  const out: DiffPart[] = []
  let i = 0
  let j = 0
  for (const edit of script) {
    if (edit === 'removed') out.push({ kind: 'removed', text: a.gaps[i]! + a.words[i++]! })
    else if (edit === 'added') out.push({ kind: 'added', text: b.gaps[j]! + b.words[j++]! })
    else {
      const [gapA, gapB] = [a.gaps[i]!, b.gaps[j]!]
      // The same word after different spaces (a line break for a space): the spaces are the change.
      if (gapA === gapB) out.push({ kind: 'same', text: gapA + a.words[i]! })
      else
        out.push(
          { kind: 'removed', text: gapA },
          { kind: 'added', text: gapB },
          { kind: 'same', text: a.words[i]! },
        )
      i++
      j++
    }
  }
  if (a.tail === b.tail) out.push({ kind: 'same', text: a.tail })
  else out.push({ kind: 'removed', text: a.tail }, { kind: 'added', text: b.tail })
  return { parts: merge(out), rough: !exact }
}

/** Words (not spaces) that are only in the new text and only in the old. */
export function diffCounts(parts: DiffPart[]): { added: number; removed: number } {
  const words = (kind: DiffPart['kind']) =>
    parts
      .filter((p) => p.kind === kind)
      .reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0)
  return { added: words('added'), removed: words('removed') }
}
