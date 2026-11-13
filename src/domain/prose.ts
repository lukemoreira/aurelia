// SPDX-License-Identifier: AGPL-3.0-or-later

type ProseBlock =
  | { kind: 'break' }
  | { kind: 'paragraph'; text: string; indent: boolean; lead?: string; rest?: string }

const LEAD_WORDS = 5
const SCENE_BREAK = /^(\*\s*){3}$|^(⁂)$/

/**
 * Plain scene text → blocks to show. The first paragraph of a scene, and the first after a
 * scene break, are not indented; the very first opens with a few words in small capitals.
 */
export function proseBlocks(body: string): ProseBlock[] {
  const blocks: ProseBlock[] = []
  let indent = false
  for (const raw of body.split(/\n\s*\n/)) {
    const text = raw.trim()
    if (!text) continue
    if (SCENE_BREAK.test(text)) {
      blocks.push({ kind: 'break' })
      indent = false
      continue
    }
    const first = blocks.length === 0
    const words = text.split(/(\s+)/)
    const split = words.slice(0, LEAD_WORDS * 2 - 1).join('')
    blocks.push({
      kind: 'paragraph',
      text,
      indent,
      ...(first && words.length > LEAD_WORDS * 2
        ? { lead: split, rest: text.slice(split.length) }
        : {}),
    })
    indent = true
  }
  return blocks
}

/** Words in a scene's text. Scene-break lines (`* * *`) are not words. */
export function countWords(body: string): number {
  let n = 0
  for (const line of body.split('\n'))
    if (!SCENE_BREAK.test(line.trim())) n += line.match(/\S+/g)?.length ?? 0
  return n
}
