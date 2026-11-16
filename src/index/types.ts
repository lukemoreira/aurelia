// SPDX-License-Identifier: AGPL-3.0-or-later
// The shapes the workspace index answers in: what a link points at, what names a scene holds.
import type { RecordType } from '@/domain/schema/record'
import type { LinkRef } from './links'
import type { Mention } from './names'

export type Tone = 'ember' | 'tide' | 'moss' | 'plum'

/** A scene or a record, as the cards, lists and pickers show it. */
export interface Target {
  kind: 'record' | 'scene'
  id: string
  title: string
  /** "Character", "Place", "Scene": what it is, in words. */
  label: string
  recordType?: RecordType
  summary?: string
  tone: Tone
  /** The book a scene is in, or a private record belongs to. */
  bookId?: string
}

/** Where a text is read from: names and links are looked up in this book, then in its universe. */
export interface Scope {
  universe: string
  book?: string
}

export type Resolution =
  | { status: 'ok'; target: Target }
  | { status: 'ambiguous'; targets: Target[] }
  | { status: 'missing' }

export interface ResolvedLink extends LinkRef {
  resolution: Resolution
}

export interface Analysis {
  links: ResolvedLink[]
  /** Names found in plain text; what the author answered "not a name" about is left out. */
  mentions: Mention[]
}

export interface Backlink {
  from: Target
  /** Explicit `[[links]]` to it, and tagged names, in that source. */
  links: number
  names: number
}

export interface OutLink {
  /** Absent for a link that points nowhere, or at more than one thing. */
  target?: Target
  /** What the text says: the name that was written. */
  text: string
  status: Resolution['status']
  links: number
  names: number
}

export interface FoundName {
  target: Target
  /** The ways it is written in this text, and how often each. */
  forms: { text: string; count: number }[]
  count: number
}

export interface OpenQuestion {
  text: string
  count: number
  reason: 'shared' | 'ask' | 'sentence-start'
  /** Who it might be. */
  candidates: Target[]
}

/** A scene or a record's notes, as a pass over every text sees it. */
export interface DocumentInfo {
  id: string
  kind: 'scene' | 'record'
  /** "Book 1 · The Gate", "Character · Elena": where a place is, in words. */
  where: string
  body: string
  scope: Scope
  ignore: ReadonlySet<string>
}
