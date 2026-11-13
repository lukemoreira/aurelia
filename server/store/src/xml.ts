// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DavEntry {
  /** Percent-encoded, starts with /dav/. A folder ends with "/". */
  href: string
  isDir: boolean
  etag: string
  /** Files only. */
  size?: number
  modified: Date
  contentType: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function response(e: DavEntry): string {
  const props = [
    e.isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>',
    `<D:getetag>${esc(e.etag)}</D:getetag>`,
    ...(e.size === undefined ? [] : [`<D:getcontentlength>${e.size}</D:getcontentlength>`]),
    `<D:getlastmodified>${e.modified.toUTCString()}</D:getlastmodified>`,
    `<D:getcontenttype>${esc(e.contentType)}</D:getcontenttype>`,
  ]
  return `<D:response><D:href>${esc(e.href)}</D:href><D:propstat><D:prop>${props.join('')}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
}

export function multistatus(entries: DavEntry[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${entries.map(response).join('')}</D:multistatus>\n`
}
