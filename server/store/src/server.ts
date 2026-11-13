// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { Authenticator } from './auth.ts'
import { HttpError } from './errors.ts'
import * as m from './methods.ts'
import { davSegments, rawPathOf } from './paths.ts'
import { fail, reply } from './reply.ts'

export interface StoreOptions {
  /** Real path (realpath) of the folder that holds the data. */
  realRoot: string
  /** null = no login check. Tests and AURELIA_STORE_INSECURE_NO_AUTH only. */
  authenticate: Authenticator | null
  log?: (line: string) => void
}

export function createStoreServer({
  realRoot,
  authenticate,
  log = console.log,
}: StoreOptions): Server {
  return createServer(async (req, res) => {
    const started = performance.now()
    const method = req.method ?? ''
    let path = '-'
    try {
      path = rawPathOf(req.url ?? '')
    } catch {
      // logged as "-"
    }
    // Method, path, status, duration. Never the token, never file contents.
    res.on('finish', () =>
      log(`${method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`),
    )
    try {
      if (path === '/healthz' && (method === 'GET' || method === 'HEAD'))
        return reply(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, 'ok\n')
      if (authenticate && !(await authenticate(req))) return fail(res, 401)
      const ctx = { realRoot, req, res, segs: davSegments(rawPathOf(req.url ?? '')) }
      switch (method) {
        case 'OPTIONS':
          return m.options(ctx)
        case 'GET':
          return await m.get(ctx, false)
        case 'HEAD':
          return await m.get(ctx, true)
        case 'PUT':
          return await m.put(ctx)
        case 'DELETE':
          return await m.del(ctx)
        case 'MKCOL':
          return await m.mkcol(ctx)
        case 'MOVE':
          return await m.move(ctx)
        case 'PROPFIND':
          return await m.propfind(ctx)
        default:
          return fail(res, 405, { Allow: m.ALLOW })
      }
    } catch (e) {
      if (res.headersSent) return void res.destroy()
      // The rest of a refused upload is not worth reading: close the connection after the answer.
      const close = { Connection: 'close' }
      if (e instanceof HttpError) return fail(res, e.status, e.status === 413 ? close : {})
      const c = e instanceof Error && 'code' in e ? String(e.code) : ''
      log(`${method} ${path} error ${e instanceof Error ? e.name : 'unknown'} ${c}`)
      fail(res, c === 'ENOSPC' ? 507 : c === 'ENAMETOOLONG' ? 414 : 500)
    }
  })
}
