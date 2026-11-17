// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseMarkdown } from './markdown/parse'

/**
 * Where a caret at `offset` in a scene's Markdown stands in the editor: the block it is in, and how
 * far into it (the editor's positions are not the file's characters, so this is near, not exact).
 */
export function blockAt(text: string, offset: number): { block: number; offset: number } | null {
  const { blocks } = parseMarkdown(text)
  let start = 0
  for (const [block, { src }] of blocks.entries()) {
    if (offset < start + src.length || block === blocks.length - 1)
      return { block, offset: Math.min(offset - start, src.length) + 1 }
    start += src.length
  }
  return null
}
