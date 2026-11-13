// SPDX-License-Identifier: AGPL-3.0-or-later
import { RemoteError } from '../errors'
import type { RemoteEntry, RemoteFile, RemoteStore, WriteOptions } from './remote-store'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Where the author's own server answers: the same address as the app, so no CORS and the login goes along. */
export const SERVER_BASE = '/dav/'

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getetag/><getcontentlength/><getlastmodified/></prop></propfind>'

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
const trim = (path: string) => path.replace(/^\/+|\/+$/g, '')
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** What a PROPFIND answered, as entries (the folder asked about comes first). Namespace-aware. */
export function parseMultistatus(xml: string, base = SERVER_BASE): RemoteEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const DAV = 'DAV:'
  // By local name AND namespace, so `D:href` and a default-namespace `href` both read.
  const named = (root: ParentNode, name: string) =>
    Array.from(root.querySelectorAll('*')).filter(
      (el) => el.localName === name && el.namespaceURI === DAV,
    )
  const text = (el: Element, name: string) => named(el, name)[0]?.textContent?.trim() ?? null
  return named(doc, 'response').flatMap((response) => {
    const href = text(response, 'href')
    if (!href) return []
    const full = decodeURIComponent(new URL(href, 'http://server.invalid').pathname)
    const path = trim(full.startsWith(base) ? full.slice(base.length) : full)
    const modified = text(response, 'getlastmodified')
    const size = Number(text(response, 'getcontentlength') ?? 0)
    return [
      {
        name: path.slice(path.lastIndexOf('/') + 1),
        path,
        folder: named(response, 'collection').length > 0,
        etag: text(response, 'getetag'),
        size: Number.isFinite(size) ? size : 0,
        modified: modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : null,
      },
    ]
  })
}

/** Standard WebDAV (RFC 4918) over `fetch`: the author's own server, and later Nextcloud. */
export class WebDavStore implements RemoteStore {
  constructor(
    private base = SERVER_BASE,
    private fetchImpl: Fetch = (input, init) => fetch(input, init),
  ) {}

  private url(path: string, folder = false) {
    const clean = encodePath(trim(path))
    return `${this.base}${clean}${folder && clean ? '/' : ''}`
  }

  /** One request. Network failure and a sign-in redirect become `offline` and `unauthorized`. */
  private async call(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: BodyInit; folder?: boolean } = {},
  ): Promise<Response> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url(path, init.folder), {
        method,
        headers: init.headers,
        body: init.body,
        // A redirect is the Cloudflare Access login page: never follow it, ask the author to sign in.
        redirect: 'manual',
        credentials: 'same-origin',
        cache: 'no-store',
      })
    } catch {
      throw new RemoteError('offline', `${method} ${path}: no answer`)
    }
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403)
      throw new RemoteError('unauthorized', `${method} ${path}: ${res.status || 'redirect'}`)
    return res
  }

  private fail(method: string, path: string, res: Response): never {
    const code =
      res.status === 412
        ? 'precondition'
        : res.status === 413
          ? 'too-large'
          : res.status === 409
            ? 'conflict'
            : 'server'
    throw new RemoteError(code, `${method} ${path}: ${res.status}`)
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const res = await this.call('PROPFIND', path, {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
      folder: true,
    })
    if (res.status === 404) return []
    if (res.status !== 207) this.fail('PROPFIND', path, res)
    const self = trim(path)
    return parseMultistatus(await res.text(), this.base).filter((e) => e.path !== self)
  }

  async read(path: string): Promise<RemoteFile | null> {
    const res = await this.call('GET', path)
    if (res.status === 404) return null
    if (res.status !== 200) this.fail('GET', path, res)
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      etag: res.headers.get('ETag'),
    }
  }

  async write(
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    options: WriteOptions = {},
  ): Promise<string | null> {
    const headers: Record<string, string> = {}
    if (options.ifMatch) headers['If-Match'] = options.ifMatch
    if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch
    const put = () => this.call('PUT', path, { headers, body: bytes })
    let res = await put()
    if (res.status === 409) {
      // The folder above is not there yet: make it, then try once more.
      await this.mkdir(parentOf(trim(path)))
      res = await put()
    }
    if (![200, 201, 204].includes(res.status)) this.fail('PUT', path, res)
    return res.headers.get('ETag')
  }

  async remove(path: string, options: { ifMatch?: string } = {}): Promise<void> {
    const res = await this.call('DELETE', path, {
      headers: options.ifMatch ? { 'If-Match': options.ifMatch } : {},
    })
    if (![200, 204, 404].includes(res.status)) this.fail('DELETE', path, res)
  }

  async mkdir(path: string): Promise<void> {
    const parts = trim(path).split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      const res = await this.call('MKCOL', folder, { folder: true })
      if (![201, 405].includes(res.status)) this.fail('MKCOL', folder, res) // 405: it is already there
    }
  }

  async move(from: string, to: string, options: { overwrite?: boolean } = {}): Promise<void> {
    const origin =
      typeof location === 'undefined' || location.origin === 'null' ? '' : location.origin
    const res = await this.call('MOVE', from, {
      headers: {
        Destination: `${origin}${this.url(to)}`,
        Overwrite: options.overwrite === false ? 'F' : 'T',
      },
    })
    if (![200, 201, 204].includes(res.status)) this.fail('MOVE', from, res)
  }
}

/** Is there a server here, and may we use it? 401 or a login redirect means it exists but needs a sign-in. */
export async function detectServer(
  base = SERVER_BASE,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Promise<'available' | 'sign-in' | 'none'> {
  try {
    const res = await fetchImpl(base, { method: 'OPTIONS', redirect: 'manual', cache: 'no-store' })
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) return 'sign-in'
    // Without the DAV header it is some other server's page (a single-page app answers every path).
    return res.status === 200 && res.headers.has('DAV') ? 'available' : 'none'
  } catch {
    return 'none'
  }
}
