// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { Stats } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { HttpError } from './errors.ts'
import {
  FOLDER_TYPE,
  contentTypeOf,
  etagOf,
  fileEtag,
  folderEtag,
  hashHandle,
  isInlineType,
  listHas,
} from './files.ts'
import { withLock } from './locks.ts'
import { RESERVED_PREFIX, destinationSegments, locate, statSafe } from './paths.ts'
import { fail, reply } from './reply.ts'
import { multistatus } from './xml.ts'
import type { DavEntry } from './xml.ts'

export const MAX_BODY = 64 * 1024 * 1024
export const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE'

export interface Ctx {
  realRoot: string
  req: IncomingMessage
  res: ServerResponse
  segs: string[]
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name]
  return Array.isArray(v) ? v.join(', ') : v
}
const code = (e: unknown) => (e instanceof Error && 'code' in e ? e.code : undefined)
/** A PUT landing inside a folder while it is deleted makes `rm` see a non-empty folder (ENOTEMPTY): try again, for about 2 s (200 + 400 + 600 + 800 ms). */
const RM_RETRY = { maxRetries: 4, retryDelay: 200 }
/** Still being written into after the retries: nothing is lost, the folder stays; the client may ask again (409). */
const removeTree = (abs: string) =>
  rm(abs, { recursive: true, ...RM_RETRY }).catch((e: unknown) => {
    throw code(e) === 'ENOTEMPTY' ? new HttpError(409, 'folder is busy') : e
  })
/** The parent folder was deleted or moved while we were writing into it (EINVAL: some systems say so). */
export const parentGone = (e: unknown) => ['ENOENT', 'ENOTDIR', 'EINVAL'].includes(String(code(e)))
const href = (segs: string[], isDir: boolean) =>
  '/dav/' + segs.map(encodeURIComponent).join('/') + (isDir && segs.length ? '/' : '')

export function options({ res }: Ctx): void {
  reply(res, 200, { DAV: '1', Allow: ALLOW, 'Content-Length': 0 })
}

export async function get({ realRoot, res, segs }: Ctx, head: boolean): Promise<void> {
  const t = await statSafe(realRoot, (await locate(realRoot, segs)).abs)
  if (!t) return fail(res, 404)
  if (t.stat.isDirectory())
    return fail(res, 405, { Allow: 'OPTIONS, PROPFIND, MKCOL, MOVE, DELETE' })
  const fh = await open(t.real, 'r')
  try {
    const { etag, size } = await hashHandle(fh)
    const type = contentTypeOf(segs.at(-1) ?? '')
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      ETag: etag,
      'Content-Length': size,
      'Last-Modified': t.stat.mtime.toUTCString(),
      'Content-Type': type,
      // Stored files are data, never pages: a stored SVG or HTML must not run script on the app's origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      ...(isInlineType(type) ? {} : { 'Content-Disposition': 'attachment' }),
    })
    if (head) return void res.end()
    // Same handle as the hash: a replace in between swaps the file, it never changes this one.
    await pipeline(fh.createReadStream({ start: 0, autoClose: false }), res)
  } finally {
    await fh.close()
  }
}

/** The write preconditions, judged against what is on disk right now (call under the lock). */
async function preconditions(
  req: IncomingMessage,
  current: { real: string; stat: Stats } | null,
): Promise<void> {
  const ifMatch = header(req, 'if-match')
  const ifNone = header(req, 'if-none-match')
  if (ifMatch === undefined && ifNone === undefined) return
  const etag = !current
    ? null
    : current.stat.isDirectory()
      ? folderEtag(current.stat.mtimeMs, current.stat.ino)
      : (await fileEtag(current.real)).etag
  if (ifMatch !== undefined && (etag === null || !listHas(ifMatch, etag)))
    throw new HttpError(412, 'If-Match failed')
  if (ifNone !== undefined && etag !== null && listHas(ifNone, etag))
    throw new HttpError(412, 'If-None-Match failed')
}

export async function put({ realRoot, req, res, segs }: Ctx): Promise<void> {
  if (!segs.length) throw new HttpError(405)
  const declared = Number(header(req, 'content-length') ?? 0)
  if (declared > MAX_BODY) throw new HttpError(413)
  const loc = await locate(realRoot, segs)
  if (!loc.parentExists) throw new HttpError(409, 'parent folder missing')

  // The upload goes to a temp file next to the target first, outside the lock, so a slow
  // client never blocks other writers. The checks and the rename are the part under the lock.
  const tmp = join(dirname(loc.abs), `${RESERVED_PREFIX}-${randomUUID()}.tmp`)
  const fh = await open(tmp, 'wx', 0o644).catch((e: unknown) => {
    throw parentGone(e) ? new HttpError(409, 'parent folder missing') : e
  })
  let renamed = false
  try {
    const hash = createHash('sha256')
    let total = 0
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        total += chunk.length
        if (total > MAX_BODY) throw new HttpError(413)
        hash.update(chunk)
        await fh.write(chunk)
      }
      await fh.sync()
    } finally {
      await fh.close()
    }
    const created = await withLock([loc.abs], async () => {
      const current = await statSafe(realRoot, loc.abs)
      if (current?.stat.isDirectory()) throw new HttpError(405, 'is a folder')
      await preconditions(req, current)
      try {
        await rename(tmp, loc.abs)
      } catch (e) {
        if (parentGone(e)) throw new HttpError(409, 'parent folder missing')
        throw e
      }
      renamed = true
      return current === null
    })
    await syncDir(dirname(loc.abs))
    reply(res, created ? 201 : 204, { ETag: etagOf(hash.digest('hex')) })
  } finally {
    if (!renamed) await rm(tmp, { force: true })
  }
}

/** Makes the rename itself durable. Best effort: not every file system allows it. */
async function syncDir(dir: string): Promise<void> {
  try {
    const d = await open(dir, 'r')
    try {
      await d.sync()
    } finally {
      await d.close()
    }
  } catch {
    // ignore
  }
}

export async function del({ realRoot, req, res, segs }: Ctx): Promise<void> {
  if (!segs.length) throw new HttpError(405)
  const { abs } = await locate(realRoot, segs)
  await withLock([abs], async () => {
    const t = await statSafe(realRoot, abs)
    if (!t) throw new HttpError(404)
    await preconditions(req, t)
    await removeTree(abs)
  })
  reply(res, 204)
}

export async function mkcol({ realRoot, res, segs }: Ctx): Promise<void> {
  if (!segs.length) throw new HttpError(405)
  const loc = await locate(realRoot, segs)
  if (!loc.parentExists) throw new HttpError(409, 'parent folder missing')
  await withLock([loc.abs], async () => {
    try {
      await mkdir(loc.abs)
    } catch (e) {
      if (code(e) === 'EEXIST') throw new HttpError(405, 'exists')
      if (code(e) === 'ENOENT' || code(e) === 'ENOTDIR')
        throw new HttpError(409, 'parent folder missing')
      throw e
    }
  })
  reply(res, 201)
}

export async function move({ realRoot, req, res, segs }: Ctx): Promise<void> {
  const dstSegs = destinationSegments(header(req, 'destination'))
  if (!segs.length || !dstSegs.length) throw new HttpError(403, 'cannot move the root')
  const ow = header(req, 'overwrite')?.toUpperCase()
  if (ow !== undefined && ow !== 'T' && ow !== 'F') throw new HttpError(400, 'bad Overwrite')
  const src = await locate(realRoot, segs)
  const dst = await locate(realRoot, dstSegs)
  const existed = await withLock([src.abs, dst.abs], async () => {
    const s = await statSafe(realRoot, src.abs)
    if (!s) throw new HttpError(404)
    await preconditions(req, s)
    if (!dst.parentExists) throw new HttpError(409, 'parent folder missing')
    if (
      src.abs === dst.abs ||
      dst.abs.startsWith(src.abs + sep) ||
      src.abs.startsWith(dst.abs + sep)
    )
      throw new HttpError(403, 'source and destination overlap')
    const d = await statSafe(realRoot, dst.abs)
    if (d && ow === 'F') throw new HttpError(412, 'destination exists')
    // A file over a file is replaced by the rename itself, atomically. Anything else goes first.
    if (d && (d.stat.isDirectory() || s.stat.isDirectory())) await removeTree(dst.abs)
    await rename(src.abs, dst.abs)
    return d !== null
  })
  reply(res, existed ? 204 : 201)
}

export async function propfind({ realRoot, req, res, segs }: Ctx): Promise<void> {
  const depth = header(req, 'depth')
  if (depth !== '0' && depth !== '1') throw new HttpError(403, 'Depth must be 0 or 1')
  const t = await statSafe(realRoot, (await locate(realRoot, segs)).abs)
  if (!t) return fail(res, 404)
  const describe = async (
    s: string[],
    real: string,
    st: NonNullable<typeof t>['stat'],
  ): Promise<DavEntry> => {
    const isDir = st.isDirectory()
    return {
      href: href(s, isDir),
      isDir,
      etag: isDir ? folderEtag(st.mtimeMs, st.ino) : (await fileEtag(real)).etag,
      ...(isDir ? {} : { size: st.size }),
      modified: st.mtime,
      contentType: isDir ? FOLDER_TYPE : contentTypeOf(s.at(-1) ?? ''),
    }
  }
  const entries = [await describe(segs, t.real, t.stat)]
  if (depth === '1' && t.stat.isDirectory()) {
    const names = (await readdir(t.real)).filter((n) => !n.startsWith(RESERVED_PREFIX)).sort()
    for (const name of names) {
      let child: Awaited<ReturnType<typeof statSafe>>
      try {
        child = await statSafe(realRoot, join(t.real, name))
      } catch (e) {
        if (e instanceof HttpError) continue // a symlink out of the root is not listed
        throw e
      }
      if (child && (child.stat.isFile() || child.stat.isDirectory()))
        entries.push(await describe([...segs, name], child.real, child.stat))
    }
  }
  reply(res, 207, { 'Content-Type': 'application/xml; charset=utf-8' }, multistatus(entries))
}
