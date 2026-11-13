// SPDX-License-Identifier: AGPL-3.0-or-later
// An in-memory WebDAV server that follows the contract of the storage container (docs/self-hosting.md):
// strong ETags, atomic PUT with If-Match / If-None-Match, 409 for a missing parent, 64 MiB limit.
// Pure data in, data out, so Vitest (through `davFetch`) and Playwright (through `page.route`) share it.
// The same tests can later run against the real container: they only ever talk to `/dav/`.

export interface DavRequest {
  method: string
  /** The path below `/dav/`, decoded, with or without a trailing slash. */
  path: string
  /** Header names in lower case. */
  headers: Record<string, string>
  body: Uint8Array | null
}

export interface DavResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array | string | null
}

interface Stored {
  bytes: Uint8Array<ArrayBuffer>
  etag: string
  modified: Date
}

export const DAV_LIMIT = 64 * 1024 * 1024
const enc = new TextEncoder()
const clean = (path: string) => path.replace(/^\/+|\/+$/g, '')
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export class FakeDav {
  files = new Map<string, Stored>()
  folders = new Set<string>([''])
  /** false: every request is refused with 401, as when the login has expired. */
  authorized = true
  /** true: every request fails with 503. */
  down = false
  /** Every request, as `METHOD path`, in order. */
  log: string[] = []
  /** Writes and removals of a file that came with no `If-Match` and no `If-None-Match`: `METHOD path`. */
  unconditional: string[] = []
  private counter = 0

  private etag = () => `"${++this.counter}"`
  private put(path: string, bytes: Uint8Array) {
    this.files.set(path, { bytes: bytes.slice(), etag: this.etag(), modified: new Date() })
  }

  // ---- for tests ----
  seed(path: string, text: string) {
    const parts = clean(path).split('/')
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join('/'))
    this.put(clean(path), enc.encode(text))
  }
  text(path: string): string | null {
    const f = this.files.get(clean(path))
    return f ? new TextDecoder().decode(f.bytes) : null
  }
  paths(prefix = ''): string[] {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort()
  }
  json<T = unknown>(path: string): T {
    return JSON.parse(this.text(path) ?? 'null') as T
  }
  /** Change a file the way another device's upload would. */
  tamper(path: string, text: string) {
    this.put(clean(path), enc.encode(text))
  }
  count(method: string, pathPrefix = '') {
    return this.log.filter((l) => l.startsWith(`${method} ${pathPrefix}`)).length
  }

  // ---- the server ----
  handle(req: DavRequest): DavResponse {
    this.log.push(`${req.method} ${clean(req.path)}`)
    const reply = (
      status: number,
      headers: Record<string, string> = {},
      body: DavResponse['body'] = null,
    ) => ({
      status,
      headers,
      body,
    })
    if (this.down) return reply(503)
    if (!this.authorized) return reply(401)
    const path = clean(req.path)
    const h = req.headers
    const isFolder = this.folders.has(path)
    const file = this.files.get(path)

    switch (req.method) {
      case 'OPTIONS':
        return reply(200, { DAV: '1', Allow: 'OPTIONS, GET, PUT, DELETE, MKCOL, MOVE, PROPFIND' })
      case 'PROPFIND': {
        if (!isFolder && !file) return reply(404)
        const rows = [path]
        if (isFolder && h['depth'] !== '0') {
          for (const f of this.folders) if (f && parentOf(f) === path && f !== path) rows.push(f)
          for (const f of this.files.keys()) if (parentOf(f) === path) rows.push(f)
        }
        const body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${rows
          .map((p) => {
            const stored = this.files.get(p)
            const href = `/dav/${p.split('/').map(encodeURIComponent).join('/')}${stored || !p ? '' : '/'}`
            return `<D:response><D:href>${xml(href)}</D:href><D:propstat><D:prop>${
              stored
                ? `<D:resourcetype/><D:getetag>${xml(stored.etag)}</D:getetag><D:getcontentlength>${stored.bytes.length}</D:getcontentlength><D:getlastmodified>${stored.modified.toUTCString()}</D:getlastmodified>`
                : '<D:resourcetype><D:collection/></D:resourcetype>'
            }</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
          })
          .join('')}</D:multistatus>`
        return reply(207, { 'Content-Type': 'application/xml; charset=utf-8' }, body)
      }
      case 'GET':
        return file ? reply(200, { ETag: file.etag }, file.bytes) : reply(404)
      case 'PUT': {
        if (h['if-match'] === undefined && h['if-none-match'] === undefined)
          this.unconditional.push(`PUT ${path}`)
        if (isFolder) return reply(405)
        if (!this.folders.has(parentOf(path))) return reply(409)
        if ((req.body?.length ?? 0) > DAV_LIMIT) return reply(413)
        if (h['if-match'] !== undefined && file?.etag !== h['if-match']) return reply(412)
        if (h['if-none-match'] === '*' && file) return reply(412)
        this.put(path, req.body ?? new Uint8Array())
        return reply(file ? 204 : 201, { ETag: this.files.get(path)!.etag })
      }
      case 'DELETE': {
        if (file && h['if-match'] === undefined) this.unconditional.push(`DELETE ${path}`)
        if (file) {
          if (h['if-match'] !== undefined && file.etag !== h['if-match']) return reply(412)
          this.files.delete(path)
          return reply(204)
        }
        if (!isFolder || !path) return reply(404)
        for (const f of [...this.files.keys()]) if (f.startsWith(`${path}/`)) this.files.delete(f)
        for (const f of [...this.folders])
          if (f === path || f.startsWith(`${path}/`)) this.folders.delete(f)
        return reply(204)
      }
      case 'MKCOL':
        if (isFolder || file) return reply(405)
        if (!this.folders.has(parentOf(path))) return reply(409)
        this.folders.add(path)
        return reply(201)
      case 'MOVE': {
        const destination = clean(
          decodeURIComponent(new URL(h['destination'] ?? '', 'http://x').pathname),
        ).replace(/^dav\//, '')
        if (!file) return reply(404)
        if (!this.folders.has(parentOf(destination))) return reply(409)
        const exists = this.files.has(destination)
        if (exists && h['overwrite'] === 'F') return reply(412)
        this.files.set(destination, { ...file, etag: this.etag() })
        this.files.delete(path)
        return reply(exists ? 204 : 201)
      }
      default:
        return reply(405)
    }
  }
}

/** `fetch` for Vitest: asks the fake, answers like a server. Only addresses under `/dav/` are known. */
export function davFetch(dav: FakeDav) {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, 'http://app.test')
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v))
    const body =
      init.body instanceof Uint8Array ? init.body : init.body ? enc.encode(String(init.body)) : null
    const r = dav.handle({
      method: init.method ?? 'GET',
      path: decodeURIComponent(url.pathname).replace(/^\/dav\/?/, ''),
      headers,
      body,
    })
    const out = typeof r.body === 'string' ? enc.encode(r.body) : r.body
    return new Response(r.status === 204 || r.status === 201 ? null : (out as BodyInit | null), {
      status: r.status,
      headers: r.headers,
    })
  }
}
