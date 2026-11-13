// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { NewerSchemaError, parseDocument } from '@/domain/migrations'

/**
 * `parseDocument`, except that a file from a newer Aurelia is still shown when it fits the
 * shape we know (`onNewer` is told, and the workspace goes read-only). One we cannot fit
 * is refused with a plain message.
 */
export function readDocument<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  onNewer: () => void,
): z.output<S> {
  try {
    return parseDocument(schema, raw)
  } catch (e) {
    if (!(e instanceof NewerSchemaError)) throw e
    onNewer()
    const loose = schema.safeParse(raw)
    if (loose.success) return loose.data
    throw new Error('This file was saved by a newer Aurelia. Update Aurelia to use it.', {
      cause: e,
    })
  }
}

/**
 * Why a file did not read: plain words first, then the parser's own line or field, which an
 * author who edits files by hand needs (the one place raw parser text reaches the screen).
 */
export function describeProblem(e: unknown): string {
  const lead = 'Aurelia could not read this file.'
  if (e instanceof z.ZodError) {
    const issue = e.issues[0]
    return `${lead} The problem is in “${issue?.path.join('.') || 'the file'}”: ${issue?.message}`
  }
  const message = e instanceof Error ? e.message : String(e)
  const line = /line (\d+)/i.exec(message)?.[1]
  return `${lead} ${line ? `The problem is near line ${line}: ` : ''}${message}`
}
