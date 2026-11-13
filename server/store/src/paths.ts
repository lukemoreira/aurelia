// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Stats } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { HttpError } from './errors.ts'

/** Names that start like this are the store's own temp files. Never listed, never served. */
export const RESERVED_PREFIX = '.aurelia-store'
export const MOUNT = '/dav'

const missing = (e: unknown) =>
  e instanceof Error && 'code' in e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')

/** The path part of a request line, raw: the URL class would silently resolve `..`. */
export function rawPathOf(url: string): string {
  if (!url.startsWith('/')) throw new HttpError(400, 'bad request target')
  return url.split(/[?#]/, 1)[0] ?? ''
}

function decodeSegment(raw: string): string {
  if (raw === '') throw new HttpError(400, 'empty path segment')
  let s: string
  try {
    s = decodeURIComponent(raw)
  } catch {
    throw new HttpError(400, 'bad percent-encoding')
  }
  // eslint-disable-next-line no-control-regex
  if (s === '.' || s === '..' || s.includes('/') || s.includes('\\') || /[\u0000-\u001f]/.test(s))
    throw new HttpError(400, 'bad path segment')
  if (s.startsWith(RESERVED_PREFIX)) throw new HttpError(403, 'reserved name')
  return s
}

/** `/dav/Book/a%20b.md` -> ['Book', 'a b.md']. Throws 404 outside /dav, 400 on anything unsafe. */
export function davSegments(rawPath: string): string[] {
  let rest: string
  if (rawPath === MOUNT) rest = ''
  else if (rawPath.startsWith(MOUNT + '/')) rest = rawPath.slice(MOUNT.length)
  else throw new HttpError(404)
  const parts = rest.split('/')
  parts.shift()
  if (parts.at(-1) === '') parts.pop()
  return parts.map(decodeSegment)
}

/** The Destination header: an absolute URL or a path. Only the path counts (see ADR-0011). */
export function destinationSegments(header: string | undefined): string[] {
  if (!header) throw new HttpError(400, 'Destination missing')
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)$/i.exec(header)
  try {
    return davSegments(rawPathOf(m?.[1] ?? header))
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(502, 'foreign destination')
    throw e
  }
}

export function assertInside(realRoot: string, p: string): void {
  if (p !== realRoot && !p.startsWith(realRoot + sep)) throw new HttpError(403, 'outside the store')
}

export interface Located {
  /** Real path of the parent folder plus the final name; the target itself may not exist. */
  abs: string
  parentExists: boolean
}

/** Resolves the parent with realpath and checks it is inside the root: no symlink escape. */
export async function locate(realRoot: string, segs: string[]): Promise<Located> {
  const name = segs.at(-1)
  if (name === undefined) return { abs: realRoot, parentExists: true }
  const parent = join(realRoot, ...segs.slice(0, -1))
  let realParent: string
  try {
    realParent = await realpath(parent)
  } catch (e) {
    if (missing(e)) return { abs: join(parent, name), parentExists: false }
    throw e
  }
  assertInside(realRoot, realParent)
  const parentExists = (await stat(realParent)).isDirectory()
  return { abs: join(realParent, name), parentExists }
}

export interface Entry {
  /** The path to read: symlinks resolved (and checked to be inside the root). */
  real: string
  stat: Stats
}

/** null when nothing is there (a dangling symlink counts as nothing). 403 for a symlink out of the root. */
export async function statSafe(realRoot: string, abs: string): Promise<Entry | null> {
  let l: Stats
  try {
    l = await lstat(abs)
  } catch (e) {
    if (missing(e)) return null
    throw e
  }
  if (!l.isSymbolicLink()) return { real: abs, stat: l }
  let real: string
  try {
    real = await realpath(abs)
  } catch (e) {
    if (missing(e)) return null
    throw e
  }
  assertInside(realRoot, real)
  return { real, stat: await stat(real) }
}
