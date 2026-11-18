// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's proposals (ADR-0008, ADR-0015): one JSON file each in `.aurelia/proposals/`. The assistant
// server writes them; the app shows them and only the author's Accept changes the manuscript. Plain TS:
// the same code runs in the browser and in Node (server/agent), so both read a scene's blocks alike.
import { z } from 'zod'

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
])
export type Proposal = z.infer<typeof proposalSchema>
export type EditProposal = Extract<Proposal, { kind: 'edit' }>

/**
 * An insertion around a paragraph that is already there (an Accept whose suggestion could not be cleared):
 * the paragraph still reads as \`before\`, so without this a second Accept would write the new text twice.
 */
const alreadyIn = (body: string, hit: Block, c: ProposalChange) =>
  c.after !== c.before &&
  ((c.after.startsWith(c.before) && body.startsWith(c.after, hit.start)) ||
    (c.after.endsWith(c.before) && body.slice(0, hit.end).endsWith(c.after)))

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
      if (c.after && body.slice(0, end).endsWith(c.after)) return { ok: false, block: c.block }
      edits.push({ start: end, end, text: `${end ? '\n\n' : ''}${c.after}` })
      continue
    }
    // The paragraph it was among those that read the same; if their number changed, which one is a guess.
    const same = blocks.filter((b) => b.text === c.before)
    const hit = same.length === (c.copies ?? 1) ? same[c.occurrence ?? 0] : undefined
    if (!hit || edits.some((e) => e.start === hit.start) || alreadyIn(body, hit, c))
      return { ok: false, block: c.block }
    // A removed block takes the blank line next to it along, so no gap is left.
    const at = blocks.indexOf(hit)
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
