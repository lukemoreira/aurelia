// SPDX-License-Identifier: AGPL-3.0-or-later
import type { z } from 'zod'
import { CURRENT_SCHEMA_VERSION } from './schema/common'

type Doc = Record<string, unknown>
type Migration = (doc: Doc) => Doc

/** Migrations keyed by the version they upgrade FROM (each returns the next version). */
const MIGRATIONS: Record<number, Migration> = {}

/** Thrown when a file is newer than this app: open read-only, never write (ADR-0003 rule 5). */
export class NewerSchemaError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`File uses schema version ${found}; this app supports up to ${supported}.`)
    this.name = 'NewerSchemaError'
  }
}

export function migrate(
  input: unknown,
  toVersion: number = CURRENT_SCHEMA_VERSION,
  registry: Record<number, Migration> = MIGRATIONS,
): Doc {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('File is not an object.')
  const doc = input as Doc
  let version = doc.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new Error('File has no valid schemaVersion.')
  if (version > toVersion) throw new NewerSchemaError(version, toVersion)

  let current = doc
  while (version < toVersion) {
    const step = registry[version]
    if (!step) throw new Error(`No migration from schema version ${version}.`)
    current = { ...step(current), schemaVersion: ++version }
  }
  return current
}

/** The one way to read a file: migrate it to the current version, then check its shape. */
export const parseDocument = <S extends z.ZodType>(schema: S, raw: unknown): z.output<S> =>
  schema.parse(migrate(raw))
