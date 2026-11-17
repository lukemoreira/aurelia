// SPDX-License-Identifier: AGPL-3.0-or-later
// What the workspace knows about names and links: which `[[…]]` points where, who is named in a
// scene, what is linked from where. Derived state (ADR-0003 rule 6): nothing here is stored, and an
// edit re-reads only the file it changed. Plain TypeScript, no screen.
import { RECORD_INFO } from '@/domain/record-types'
import { bookScenes } from '@/domain/outline'
import { colourOf } from '@/domain/scene-details'
import { TEXT_FIELDS, type RecordType } from '@/domain/schema/record'
import type { RecordDoc, SceneDoc, WorkspaceData } from '@/domain/workspace-data'
import { needsId, parseLinks, type LinkRef } from './links'
import {
  buildMatcher,
  findNames,
  skipZones,
  withoutIgnored,
  ignoreKey,
  type NameForm,
  type NameMatcher,
} from './names'
import { findNewNames, type NewName } from './new-names'
import { fold } from './palette-search'
import { linksTo, foundNames, nameUsage, openQuestions } from './reports'
import { SearchIndex, type SearchHit } from './search'
import type {
  Analysis,
  Backlink,
  DocumentInfo,
  FoundName,
  OpenQuestion,
  OutLink,
  Resolution,
  ResolvedLink,
  Scope,
  Target,
  Tone,
} from './types'

export type {
  Analysis,
  Backlink,
  DocumentInfo,
  FoundName,
  OpenQuestion,
  OutLink,
  Resolution,
  ResolvedLink,
  Scope,
  Target,
  Tone,
} from './types'

interface Doc {
  kind: 'scene' | 'record'
  id: string
  src: SceneDoc | RecordDoc
  title: string
  body: string
  scope: Scope
  ignore: Set<string>
  links: LinkRef[]
  /** What the cards and lists show of it: when it changes, so does everything that points at it. */
  sig: string
  cache?: { version: number; value: Analysis }
}

const TONE_BY_TYPE: Partial<Record<RecordType, Tone>> = {
  character: 'ember',
  place: 'moss',
  world: 'moss',
}

export class WorkspaceIndex {
  private data: WorkspaceData | null = null
  private docs = new Map<string, Doc>()
  private bookUniverse = new Map<string, string>()
  private chapterBook = new Map<string, string>()
  /** Bumped when a name, a title or a scope changes: everything derived from names is then stale. */
  private structure = 0
  private titles: {
    version: number
    records: Map<string, RecordDoc[]>
    aliases: Map<string, RecordDoc[]>
    scenes: Map<string, SceneDoc[]>
  } | null = null
  private matchers = new Map<string, { version: number; matcher: NameMatcher }>()
  private search_ = new SearchIndex()

  /** The version of what names and titles say: a screen that shows names reads this to know when to look again. */
  get version() {
    return this.structure
  }

  /**
   * Bring the index up to date with the workspace. A file whose object is the one already known is
   * not read again, so a keystroke in one scene costs that scene alone.
   */
  sync(data: WorkspaceData) {
    this.data = data
    this.bookUniverse.clear()
    this.chapterBook.clear()
    for (const u of data.universes) for (const b of u.books) this.bookUniverse.set(b, u.id)
    for (const c of data.chapters) this.chapterBook.set(c.id, c.book)
    const seen = new Set<string>()
    for (const s of data.scenes) {
      seen.add(s.meta.id)
      this.ingest(s.meta.id, s, 'scene')
    }
    for (const r of data.records) {
      seen.add(r.meta.id)
      this.ingest(r.meta.id, r, 'record')
    }
    for (const id of this.docs.keys())
      if (!seen.has(id)) {
        this.docs.delete(id)
        this.search_.remove(id)
        this.structure++
      }
  }

  private scopeOf(kind: 'scene' | 'record', src: SceneDoc | RecordDoc): Scope {
    if (kind === 'record') {
      const r = src as RecordDoc
      return {
        universe: r.universe,
        ...(r.meta.scope.startsWith('book:') ? { book: r.meta.scope.slice(5) } : {}),
      }
    }
    const s = src as SceneDoc
    const book = s.book ?? this.chapterBook.get(s.meta.chapter)
    return { universe: (book && this.bookUniverse.get(book)) ?? '', ...(book ? { book } : {}) }
  }

  private ingest(id: string, src: SceneDoc | RecordDoc, kind: 'scene' | 'record') {
    const old = this.docs.get(id)
    const scope = this.scopeOf(kind, src)
    if (
      old &&
      old.src === src &&
      old.scope.book === scope.book &&
      old.scope.universe === scope.universe
    )
      return
    const body = src.body ?? ''
    const title = src.meta.title
    const sig = JSON.stringify(
      kind === 'record'
        ? [
            title,
            scope,
            (src as RecordDoc).meta.type,
            (src as RecordDoc).meta.aliases ?? [],
            (src.meta as { color?: unknown }).color ?? null,
            (src as RecordDoc).summary ?? '',
          ]
        : [
            title,
            scope,
            (src as SceneDoc).meta.summary ?? '',
            (src as SceneDoc).meta.ignoreNames ?? [],
          ],
    )
    this.docs.set(id, {
      kind,
      id,
      src,
      title,
      body,
      scope,
      sig,
      ignore: new Set(kind === 'scene' ? ((src as SceneDoc).meta.ignoreNames ?? []) : []),
      links: parseLinks(body),
    })
    // A name, a title, a summary or a place changed: whatever was worked out from them is stale.
    if (old?.sig !== sig) this.structure++
    this.search_.touch(id)
  }

  // ---- what a name or a link points at -------------------------------------------------

  private target(doc: SceneDoc | RecordDoc): Target {
    const meta = doc.meta
    if ('universe' in doc) {
      const type = (meta as RecordDoc['meta']).type
      const tone = colourOf(doc) ?? TONE_BY_TYPE[type] ?? 'tide'
      const scope = (meta as RecordDoc['meta']).scope
      return {
        kind: 'record',
        id: meta.id,
        title: meta.title,
        label: RECORD_INFO[type].label,
        recordType: type,
        ...(doc.summary ? { summary: doc.summary } : {}),
        tone,
        ...(scope.startsWith('book:') ? { bookId: scope.slice(5) } : {}),
      }
    }
    const scene = doc as SceneDoc
    const book = scene.book ?? this.chapterBook.get(scene.meta.chapter)
    return {
      kind: 'scene',
      id: meta.id,
      title: meta.title,
      label: 'Scene',
      ...(scene.meta.summary ? { summary: scene.meta.summary } : {}),
      tone: 'tide',
      ...(book ? { bookId: book } : {}),
    }
  }

  /** Where a scene or a record's notes are read from. */
  scope(id: string): Scope | undefined {
    return this.docs.get(id)?.scope
  }

  /** What an ID names, if it is a scene or a record of this workspace. */
  targetOf(id: string): Target | undefined {
    const doc = this.docs.get(id)
    return doc ? this.target(doc.src) : undefined
  }

  private tables() {
    if (this.titles?.version === this.structure) return this.titles
    const records = new Map<string, RecordDoc[]>()
    const aliases = new Map<string, RecordDoc[]>()
    const scenes = new Map<string, SceneDoc[]>()
    const add = <T>(m: Map<string, T[]>, key: string, v: T) => {
      if (key) m.set(key, [...(m.get(key) ?? []), v])
    }
    for (const r of this.data?.records ?? []) {
      add(records, fold(r.meta.title), r)
      for (const a of new Set((r.meta.aliases ?? []).map((x) => fold(x.text)))) add(aliases, a, r)
    }
    for (const s of this.data?.scenes ?? []) add(scenes, fold(s.meta.title), s)
    return (this.titles = { version: this.structure, records, aliases, scenes })
  }

  /**
   * The thing a written name points at, seen from `scope`: a record of the book first, then one
   * shared by the universe (a title before an alias); then a scene of the book, then of the
   * universe. Two at one step is ambiguous (the picker then writes an ID instead).
   */
  resolveName(name: string, scope: Scope): Resolution {
    const key = fold(name)
    if (!key) return { status: 'missing' }
    const t = this.tables()
    const tiers: ((r: RecordDoc) => boolean)[] = [
      (r) => !!scope.book && r.meta.scope === `book:${scope.book}`,
      (r) => r.meta.scope === 'universe' && r.universe === scope.universe,
    ]
    const verdict = (hits: (RecordDoc | SceneDoc)[]): Resolution | undefined =>
      hits.length === 0
        ? undefined
        : hits.length === 1
          ? { status: 'ok', target: this.target(hits[0]!) }
          : { status: 'ambiguous', targets: hits.map((h) => this.target(h)) }
    for (const tier of tiers)
      for (const table of [t.records, t.aliases]) {
        const found = verdict((table.get(key) ?? []).filter(tier))
        if (found) return found
      }
    const sceneTiers: ((s: SceneDoc) => boolean)[] = [
      (s) => !!scope.book && this.scopeOf('scene', s).book === scope.book,
      (s) => this.scopeOf('scene', s).universe === scope.universe,
    ]
    for (const tier of sceneTiers) {
      const found = verdict((t.scenes.get(key) ?? []).filter(tier))
      if (found) return found
    }
    return { status: 'missing' }
  }

  resolveLink(link: LinkRef, scope: Scope): Resolution {
    if (link.id !== undefined) {
      const target = this.targetOf(link.id)
      return target ? { status: 'ok', target } : { status: 'missing' }
    }
    return this.resolveName(link.target, scope)
  }

  /** Every name (title and aliases) of the records seen from a scope. */
  formsFor(scope: Scope): NameForm[] {
    const forms: NameForm[] = []
    for (const r of this.data?.records ?? []) {
      const visible =
        r.meta.scope === 'universe'
          ? r.universe === scope.universe
          : !!scope.book && r.meta.scope === `book:${scope.book}`
      if (!visible) continue
      forms.push({ recordId: r.meta.id, text: r.meta.title, mode: 'auto' })
      for (const a of r.meta.aliases ?? [])
        forms.push({ recordId: r.meta.id, text: a.text, mode: a.match ?? 'auto' })
    }
    return forms
  }

  /** The names of a scope, ready to look for in a text. */
  matcherFor(scope: Scope): NameMatcher {
    const key = `${scope.universe}|${scope.book ?? ''}`
    const known = this.matchers.get(key)
    if (known?.version === this.structure) return known.matcher
    const matcher = buildMatcher(this.formsFor(scope))
    this.matchers.set(key, { version: this.structure, matcher })
    return matcher
  }

  /** Every scene and every record's notes, in reading order, with what a pass over the text needs. */
  documents(): DocumentInfo[] {
    const book = (id?: string) => this.data?.books.find((b) => b.id === id)?.title ?? ''
    return this.order().flatMap((id) => {
      const d = this.docs.get(id)
      if (!d) return []
      const where =
        d.kind === 'scene'
          ? `${book(d.scope.book)} · ${d.title}`
          : `${RECORD_INFO[(d.src as RecordDoc).meta.type].label} · ${d.title}`
      return [{ id, kind: d.kind, where, body: d.body, scope: d.scope, ignore: d.ignore }]
    })
  }

  /** Links and names in any text, seen from `scope`. The editor asks this of the text on screen. */
  analyseText(text: string, scope: Scope, ignored: ReadonlySet<string> = new Set()): Analysis {
    const links = parseLinks(text)
    const resolved = links.map((l): ResolvedLink => ({
      ...l,
      resolution: this.resolveLink(l, scope),
    }))
    const mentions = findNames(text, this.matcherFor(scope), skipZones(text, links))
    return {
      links: resolved,
      mentions: withoutIgnored(text, mentions, ignored),
    }
  }

  /** What a scene or a record's notes link to and name. Kept until the file or a name changes. */
  analysis(id: string): Analysis | undefined {
    const doc = this.docs.get(id)
    if (!doc) return undefined
    if (doc.cache?.version === this.structure) return doc.cache.value
    const value = this.analyseText(doc.body, doc.scope, doc.ignore)
    doc.cache = { version: this.structure, value }
    return value
  }

  /** The "not a name" key of every place `text` is found as a name in a scene. */
  ignoreKeys(sceneId: string, text: string): string[] {
    const doc = this.docs.get(sceneId)
    if (!doc) return []
    return (this.analysis(sceneId)?.mentions ?? [])
      .filter((m) => m.text === text)
      .map((m) => ignoreKey(doc.body, m))
  }

  // ---- links, backlinks and names, per file ---------------------------------------------

  /** Reading order: scenes as the outline lists them, then records, so a list of sources is not shuffled. */
  private order(): string[] {
    const data = this.data
    if (!data) return []
    const ids: string[] = []
    for (const b of data.books) for (const s of bookScenes(data, b.id)) ids.push(s.meta.id)
    const seen = new Set(ids)
    for (const s of data.scenes) if (!seen.has(s.meta.id)) ids.push(s.meta.id)
    for (const r of data.records) ids.push(r.meta.id)
    return ids
  }

  /** What links to `id`, or names it by a tagged name, and how often. */
  backlinks(id: string): Backlink[] {
    const out: Backlink[] = []
    for (const from of this.order()) {
      if (from === id) continue
      const a = this.analysis(from)
      if (!a) continue
      const links = a.links.filter((l) => hits(l.resolution, id)).length
      const names = a.mentions.filter((m) => m.status === 'tagged' && m.recordIds[0] === id).length
      if (links || names) out.push({ from: this.targetOf(from)!, links, names })
    }
    return out
  }

  /** What `id`'s text links to or names, and links that point nowhere or at several things. */
  linksTo(id: string): OutLink[] {
    return linksTo(this, id)
  }

  /** The records named in a scene (by links or tagged names), with the ways each is written. */
  foundNames(id: string): FoundName[] {
    return foundNames(this, id)
  }

  /** How a record is written across the workspace: each form and how often, in how many files, and the places still a question. */
  nameUsage(recordId: string) {
    return nameUsage(this, recordId)
  }

  /** Names the text leaves a question about, grouped by the word written. */
  openQuestions(id: string): OpenQuestion[] {
    return openQuestions(this, id)
  }

  /**
   * Capitalised words that recur in a book's scenes and are not a record yet (ADR-0010 §5): the
   * words of every name already known, and the words the author said are not names, are left out.
   */
  newNames(bookId: string): NewName[] {
    const data = this.data
    const universe = this.bookUniverse.get(bookId)
    const book = data?.books.find((b) => b.id === bookId)
    if (!data || !book || !universe) return []
    const known = new Set(
      this.formsFor({ universe, book: bookId }).flatMap((f) =>
        (f.text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(fold),
      ),
    )
    const texts = bookScenes(data, bookId).flatMap((s) => {
      const doc = this.docs.get(s.meta.id)
      const a = this.analysis(s.meta.id)
      if (!doc || !a) return []
      const skip = [
        ...skipZones(doc.body, a.links),
        ...a.mentions.map((m): [number, number] => [m.start, m.end]),
      ]
      return [{ id: doc.id, title: doc.title, body: doc.body, skip }]
    })
    return findNewNames(texts, known, new Set(book.notNames ?? []), fold)
  }

  // ---- picking and searching ------------------------------------------------------------

  /** Records and scenes a `[[` can point at from `scope`, best match first. An empty query lists some. */
  pick(query: string, scope: Scope, limit = 8): (Target & { byId: boolean })[] {
    const q = fold(query)
    const data = this.data
    if (!data) return []
    const visible = (s: Scope) => s.universe === scope.universe
    const rows: { target: Target; rank: number; at: number }[] = []
    const consider = (target: Target, names: string[], base: number) => {
      const ranks = names.map((n) => {
        const i = fold(n).indexOf(q)
        return i < 0 ? -1 : i === 0 ? 0 : 1
      })
      const best = q ? Math.min(...ranks.filter((r) => r >= 0), 2) : 0
      if (!q || best < 2) rows.push({ target: target, rank: base * 2 + best, at: rows.length })
    }
    for (const r of data.records) {
      const s = this.docs.get(r.meta.id)?.scope
      const okScope = s && visible(s) && (r.meta.scope === 'universe' || s.book === scope.book)
      if (okScope)
        consider(this.target(r), [r.meta.title, ...(r.meta.aliases ?? []).map((a) => a.text)], 0)
    }
    for (const s of data.scenes) {
      const sc = this.docs.get(s.meta.id)?.scope
      if (sc && visible(sc))
        consider(this.target(s), [s.meta.title], sc.book === scope.book ? 1 : 2)
    }
    rows.sort((a, b) => a.rank - b.rank || a.at - b.at)
    return rows.slice(0, limit).map(({ target }) => {
      const r = this.resolveName(target.title, scope)
      return { ...target, byId: r.status === 'ambiguous' || needsId(target.title) }
    })
  }

  /** What is searched of a file besides its title: its summary, what its sheet says, then its text or notes. */
  private searchText(d: Doc): string {
    const summary =
      d.kind === 'record' ? (d.src as RecordDoc).summary : (d.src as SceneDoc).meta.summary
    const sheet = d.kind === 'record' ? sheetText((d.src as RecordDoc).meta) : undefined
    return [summary, sheet, d.body].filter(Boolean).join('\n\n')
  }

  /** Full-text search over titles, other names, summaries, scenes and notes. */
  search(query: string, limit = 20): SearchHit[] {
    this.search_.refresh((id) => {
      const d = this.docs.get(id)
      if (!d) return undefined
      const aliases =
        d.kind === 'record'
          ? ((d.src as RecordDoc).meta.aliases ?? []).map((a) => a.text).join(' ')
          : ''
      return { id, kind: d.kind, title: d.title, aliases, body: this.searchText(d) }
    })
    return this.search_.query(query, limit, (id) => {
      const d = this.docs.get(id)
      return d && this.searchText(d)
    })
  }
}

/** The words of a record's sheet (its fields, its sources and what it is to others), so a search finds them. */
function sheetText(meta: RecordDoc['meta']): string {
  const fields = TEXT_FIELDS.map((k) => meta[k]).filter((v): v is string => !!v)
  const sources = (meta.sources ?? []).flatMap((x) => [x.title, x.author, x.url, x.note])
  const relations = (meta.relationships ?? []).map((r) => r.type)
  return [...fields, ...sources, ...relations].filter(Boolean).join('\n')
}

const hits = (r: Resolution, id: string) => r.status === 'ok' && r.target.id === id
