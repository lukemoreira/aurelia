// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, watch } from 'vue'

export interface SourceTextOptions {
  /** Whether the workspace takes what is typed now. A text it did not take is sent again when it does. */
  editable?: () => boolean
  /** Words typed in the other editor that the workspace had not taken: they are shown, and sent again. */
  held?: string | null
}

/**
 * A scene's Markdown typed into a plain text area (the source mode). What is typed is the text
 * saved: `onEdit` gets it exactly, and nothing is sent until a key is pressed, so opening the
 * area and leaving it writes nothing. A text area shows its lines with `\n` whatever they end in,
 * so a file whose lines all end in `\r\n` gets that back when it is typed in (a file that mixes
 * the two is saved with `\n`).
 */
export function useSourceText(
  body: () => string,
  onEdit: (body: string) => void,
  options: SourceTextOptions = {},
) {
  const editable = options.editable ?? (() => true)
  const crlf = (text: string) => text.includes('\r\n') && !/(^|[^\r])\n/.test(text)
  const shown = (text: string) => text.replace(/\r\n/g, '\n')
  const start = options.held ?? body()
  let windows = crlf(start)
  const text = ref(shown(start))
  /**
   * What was last sent, until the workspace answers with it. It stays on screen, whatever else
   * arrives, and is sent again when the workspace can take it (as in the editor).
   */
  let sent: string | null = start !== body() ? start : null
  if (sent !== null && editable()) onEdit(sent)

  function input(value: string) {
    text.value = value
    const next = windows ? value.replace(/\n/g, '\r\n') : value
    // Typed back to what the workspace already holds: nothing to wait for.
    sent = next === body() ? null : next
    onEdit(next)
  }

  watch(body, (next) => {
    if (sent !== null) {
      if (next === sent) sent = null
      return
    }
    // Changed outside (another device, a restored copy): draw it again, with its own line endings.
    windows = crlf(next)
    text.value = shown(next)
  })
  watch(editable, (can) => {
    if (can && sent !== null && sent !== body()) onEdit(sent)
  })

  return { text, input, pending: () => sent }
}
