// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Authenticator } from '../src/auth.ts'
import { createStoreServer } from '../src/server.ts'

export interface Store {
  port: number
  /** The data folder. */
  root: string
  /** A sibling folder that must never be touched. */
  outside: string
  server: Server
  close: () => Promise<void>
}

export async function startStore(authenticate: Authenticator | null = null): Promise<Store> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'aurelia-store-test-')))
  const root = join(base, 'data')
  const outside = join(base, 'outside')
  await mkdir(root)
  await mkdir(outside)
  const server = createStoreServer({ realRoot: root, authenticate, log: () => {} })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    port: (server.address() as AddressInfo).port,
    root,
    outside,
    server,
    close: async () => {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
      await rm(base, { recursive: true, force: true })
    },
  }
}

export interface Res {
  status: number
  headers: IncomingHttpHeaders
  text: string
  body: Buffer
}

/** A request with the path exactly as given (fetch and URL would resolve `..`). */
export function dav(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, headers: opts.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: body.toString('utf8'),
            body,
          })
        })
      },
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

/** Raw socket: for requests the HTTP client would refuse to send (a lying Content-Length, an endless body). */
export function raw(port: number, head: string, chunks: Buffer[] = []): Promise<string> {
  return new Promise((resolve) => {
    const s = connect(port, '127.0.0.1')
    let out = ''
    s.on('data', (d) => (out += d.toString('latin1')))
    s.on('error', () => {})
    s.on('close', () => resolve(out))
    s.write(head)
    void (async () => {
      for (const c of chunks) if (!s.write(c)) await new Promise((r) => s.once('drain', r))
    })()
  })
}
