// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's proposals (ADR-0008, ADR-0015): one JSON file each in `.aurelia/proposals/`. The assistant
// server writes them; the app shows them and only the author's Accept changes the manuscript. Plain TS:
// the same code runs in the browser and in Node (server/agent), so both read a scene's blocks alike.
import { z } from 'zod'
import { CHARACTER_FIELDS, type BaseSection, type StoryBase } from './story-base'

export const PROPOSALS_DIR = '.aurelia/proposals'
export const proposalPath = (id: string) => `${PROPOSALS_DIR}/${id}.json`

/** One block of a scene's text: a run of lines between blank lines, with where it sits in the text. */
export interface Block {
  /** `b<index>-<8 hex>`: the block's place and a fingerprint of its text. Never written into a scene. */
  id: string
  text: string
  start: number
  end: number
}

/** FNV-1a, 32 bits: a short, synchronous fingerprint. Equality of the text itself is what Accept checks. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The blocks of a scene's text (the body the editor shows), in order. */
export function sceneBlocks(body: string): Block[] {
  const out: Block[] = []
  const re = /\S[\s\S]*?(?=\n[ \t]*\n|\s*$)/g
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const text = m[0].replace(/\s+$/, '')
    out.push({
      id: `b${out.length}-${fingerprint(text)}`,
      text,
      start: m.index,
      end: m.index + text.length,
    })
  }
  return out
}

const change = z.object({
  /** The block this replaces (`b3-1a2b3c4d`), or `end` to add after the last block. */
  block: z.string().min(1),
  /** The block's text when the proposal was made ('' for `end`): Accept requires it unchanged. */
  before: z.string(),
  /** What it becomes. '' removes the block; several paragraphs (blank lines between) insert new ones. */
  after: z.string(),
  /** Which of the paragraphs that read as `before` it was (0 = the first), and how many there were. */
  occurrence: z.number().int().min(0).default(0),
  copies: z.number().int().min(0).default(1),
})
export type ProposalChange = z.input<typeof change>

/** Where a block stands among the blocks that read exactly as it does, for `occurrence` and `copies`. */
export function anchorOf(blocks: readonly Block[], block: Block) {
  const same = blocks.filter((b) => b.text === block.text)
  return { occurrence: same.indexOf(block), copies: same.length }
}

/** A story-base section: its text when proposed ('' when empty; any length the author wrote), and what it becomes. */
const section = z.object({ before: z.string(), after: z.string().max(20_000) })

const common = {
  schemaVersion: z.literal(1),
  id: z.string().regex(/^prp_[a-z0-9]{10}$/),
  createdAt: z.string(),
  /** Who made it, in words ("Claude"). */
  by: z.string().max(80),
  /** One line: why. Shown to the author. */
  why: z.string().max(2000),
  /** A revised proposal names the one it replaces; the app keeps only the newest. */
  replaces: z
    .string()
    .regex(/^prp_[a-z0-9]{10}$/)
    .optional(),
}

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('edit'),
    sceneId: z.string(),
    sceneTitle: z.string(),
    /** SHA-256 of the scene's text when the proposal was made. */
    baseHash: z.string(),
    changes: z.array(change).min(1).max(50),
  }),
  z.object({
    ...common,
    kind: z.literal('scene'),
    /** A new scene with draft text, at the end of this chapter. */
    chapterId: z.string(),
    title: z.string().min(1).max(200),
    text: z.string().max(200_000),
  }),
  z.object({
    ...common,
    kind: z.literal('base'),
    /** Sections of a book's story base (ADR-0016), each with the text it had when proposed. */
    bookId: z.string(),
    bookTitle: z.string(),
    sections: z.object({
      objectives: section.optional(),
      world: section.optional(),
      narrative: section.optional(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('character'),
    /** A new Character record in the book's universe, with the details of its sheet. */
    bookId: z.string(),
    name: z.string().min(1).max(200),
    summary: z.string().max(4000).optional(),
    fields: z.object(
      Object.fromEntries(
        CHARACTER_FIELDS.map((k) => [k, z.string().max(4000).optional()]),
      ) as Record<(typeof CHARACTER_FIELDS)[number], z.ZodOptional<z.ZodString>>,
    ),
  }),
])
export type Proposal = z.infer<typeof proposalSchema>
export type EditProposal = Extract<Proposal, { kind: 'edit' }>
export type BaseProposal = Extract<Proposal, { kind: 'base' }>

/**
 * Accept of a story-base proposal: every section it changes must still read as it did (`before`), else
 * nothing changes. A section accepted already reads as `after` and no longer as `before`, so a second
 * Accept is refused too. `base` holds only the sections it changes: the caller puts them over the stored
 * base, so the others, and keys this version does not know, stay as they are.
 */
export function mergeBase(
  now: Record<BaseSection, string>,
  sections: BaseProposal['sections'],
): { ok: true; base: StoryBase; replaced: boolean } | { ok: false } {
  const base: StoryBase = {}
  let replaced = false
  for (const [key, c] of Object.entries(sections) as [
    BaseSection,
    { before: string; after: string },
  ][]) {
    if (!c) continue
    if (now[key] !== c.before) return { ok: false }
    if (c.before.trim()) replaced = true
    base[key] = c.after
  }
  return { ok: true, base, replaced }
}

/** The paragraphs `texts` sit, whole and in this order, from block `from`. */
const sitsAt = (blocks: readonly Block[], from: number, texts: readonly string[]) =>
  from >= 0 && texts.every((t, i) => blocks[from + i]?.text === t)

const paragraphs = (text: string) => sceneBlocks(text).map((b) => b.text)

/**
 * An Accept whose suggestion could not be cleared: its paragraphs are all there already, whole, around the
 * one that still reads as `before`. A second Accept would write the new ones twice.
 */
const alreadyIn = (blocks: readonly Block[], at: number, c: ProposalChange) => {
  const after = paragraphs(c.after)
  return after.length > 1 && after.some((t, k) => t === c.before && sitsAt(blocks, at - k, after))
}

export type Merge = { ok: true; body: string } | { ok: false; block: string }

/**
 * Accept, as a per-block 3-way merge: each changed block must still read exactly as it did when the
 * proposal was made (the place it had first, else the one block that reads so). Everything else in the
 * scene may have changed meanwhile and stays as it is now. A block that is gone or changed refuses the
 * whole proposal: nothing is half-applied.
 */
export function mergeChanges(body: string, changes: readonly ProposalChange[]): Merge {
  const blocks = sceneBlocks(body)
  const edits: { start: number; end: number; text: string }[] = []
  for (const c of changes) {
    if (c.block === 'end') {
      const end = body.replace(/\s+$/, '').length
      // Accepted already (the file could not be cleared): adding it again would write it twice.
      const added = paragraphs(c.after)
      if (added.length && sitsAt(blocks, blocks.length - added.length, added))
        return { ok: false, block: c.block }
      edits.push({ start: end, end, text: `${end ? '\n\n' : ''}${c.after}` })
      continue
    }
    // The paragraph it was among those that read the same; if their number changed, which one is a guess.
    const same = blocks.filter((b) => b.text === c.before)
    const hit = same.length === (c.copies ?? 1) ? same[c.occurrence ?? 0] : undefined
    const at = hit ? blocks.indexOf(hit) : -1
    if (!hit || edits.some((e) => e.start === hit.start) || alreadyIn(blocks, at, c))
      return { ok: false, block: c.block }
    // A removed block takes the blank line next to it along, so no gap is left.
    const next = blocks[at + 1]
    const prev = blocks[at - 1]
    edits.push(
      c.after !== ''
        ? { start: hit.start, end: hit.end, text: c.after }
        : next
          ? { start: hit.start, end: next.start, text: '' }
          : { start: prev ? prev.end : hit.start, end: hit.end, text: '' },
    )
  }
  let out = body
  let limit = body.length
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    // Two removals side by side would both take the blank line between them: the later one keeps it.
    out = out.slice(0, e.start) + e.text + out.slice(Math.min(e.end, limit))
    limit = e.start
  }
  return { ok: true, body: out }
}
