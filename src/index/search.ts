// SPDX-License-Identifier: AGPL-3.0-or-later
import MiniSearch from 'minisearch'

/** What is searched of one scene or record. */
export interface SearchDoc {
  id: string
  kind: 'scene' | 'record'
  title: string
  aliases: string
  body: string
}

export interface SearchHit {
  id: string
  kind: 'scene' | 'record'
  title: string
  score: number
  /** A line of the text around the words found, when they were found in the text and not only in the title. */
  snippet?: string
  /** Where the words found stand in `snippet`, to be drawn marked. */
  marks?: [start: number, end: number][]
  /** The first word found in the text (folded): opening the file at it selects that word. */
  term?: string
}

/** Case, accents and apostrophes do not matter: "Warden’s" is found by "wardens". */
const term = (t: string) =>
  t.normalize('NFD').replace(/\p{M}/gu, '').replace(/['’‘]/g, '').toLowerCase()

/** The text folded as search folds it, and where each folded letter stands in the original. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = ''
  const at: number[] = []
  let i = 0
  for (const ch of text) {
    const f = term(ch)
    for (let k = 0; k < f.length; k++) at.push(i)
    folded += f
    i += ch.length
  }
  return { folded, at }
}

const isLetter = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

/** The first place `word` starts a word in `text`, as a range of the original text; null when none. */
export function findFolded(text: string, word: string): [number, number] | null {
  const w = term(word)
  if (!w) return null
  const { folded, at } = foldWithMap(text)
  for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1))
    if (!isLetter(folded[i - 1])) {
      const last = at[i + w.length - 1]!
      return [at[i]!, last + (text.codePointAt(last)! > 0xffff ? 2 : 1)]
    }
  return null
}

/** A line around the first of `terms` in the text (folded as search folds it), and where they stand in it. */
function snippetOf(
  body: string,
  terms: string[],
): { snippet: string; marks: [number, number][]; term: string } | undefined {
  const plain = body.replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, '$1').replace(/[*_^`>#]/g, '')
  const { folded, at } = foldWithMap(plain)
  const found: { from: number; to: number; term: string }[] = []
  for (const t of terms) {
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + 1))
      if (!isLetter(folded[i - 1])) {
        const last = at[i + t.length - 1]!
        found.push({ from: at[i]!, to: last + 1, term: t })
      }
  }
  if (!found.length) return undefined
  found.sort((a, b) => a.from - b.from)
  const start = Math.max(0, found[0]!.from - 40)
  const end = Math.min(plain.length, found[0]!.from + 90)
  // Whitespace is squeezed to one space, so marks are placed on the squeezed text.
  let out = ''
  const place: number[] = []
  for (let i = start; i < end; i++) {
    const c = plain[i]!
    if (/\s/.test(c) && (out === '' || /\s$/.test(out))) place[i - start] = out.length
    else {
      place[i - start] = out.length
      out += /\s/.test(c) ? ' ' : c
    }
  }
  const lead = start > 0 ? '…' : ''
  const marks = found
    .filter((f) => f.from >= start && f.to <= end)
    .map((f): [number, number] => [
      lead.length + place[f.from - start]!,
      lead.length + place[f.to - 1 - start]! + 1,
    ])
  const trimmed = out.replace(/\s+$/, '')
  return {
    snippet: `${lead}${trimmed}${end < plain.length ? '…' : ''}`,
    marks: marks.filter(([, b]) => b <= lead.length + trimmed.length),
    term: found[0]!.term,
  }
}

/**
 * Search over the workspace's own words (MiniSearch, in the browser, offline). Documents are
 * added when a search first needs them and again only when they changed, so typing never pays for
 * it: an edit just marks the file.
 */
export class SearchIndex {
  private mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'aliases', 'body'],
    storeFields: ['kind', 'title'],
    processTerm: (t) => term(t) || null,
    searchOptions: {
      prefix: true,
      fuzzy: (t) => (t.length > 4 ? 0.15 : false),
      boost: { title: 4, aliases: 3 },
      combineWith: 'AND',
      processTerm: (t) => term(t) || null,
    },
  })
  private dirty = new Set<string>()

  /** The file changed or is new: read it again at the next search. */
  touch(id: string) {
    this.dirty.add(id)
  }
  remove(id: string) {
    this.dirty.delete(id)
    if (this.mini.has(id)) this.mini.discard(id)
  }

  /** Read again what changed since the last search. `read` returns undefined for a file that is gone. */
  refresh(read: (id: string) => SearchDoc | undefined) {
    for (const id of this.dirty) {
      if (this.mini.has(id)) this.mini.discard(id)
      const doc = read(id)
      if (doc) this.mini.add(doc)
    }
    this.dirty.clear()
  }

  /** Best matches first. `bodyOf` gives a file's text, to show the line a word was found in. */
  query(text: string, limit: number, bodyOf: (id: string) => string | undefined): SearchHit[] {
    if (!text.trim()) return []
    return this.mini
      .search(text)
      .slice(0, limit)
      .map((r) => {
        const hit: SearchHit = {
          id: r.id as string,
          kind: r.kind as SearchDoc['kind'],
          title: r.title as string,
          score: r.score,
        }
        const inText = Object.values(r.match).some((fields) => fields.includes('body'))
        // The words that really matched, fuzzy and prefix matches included, as the index holds them.
        const found = inText ? snippetOf(bodyOf(hit.id) ?? '', r.terms) : undefined
        return found ? { ...hit, ...found } : hit
      })
  }
}
