// SPDX-License-Identifier: AGPL-3.0-or-later
import { STATUS_CODES } from 'node:http'
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http'

export function reply(
  res: ServerResponse,
  status: number,
  headers: OutgoingHttpHeaders = {},
  body?: string,
): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

/** Error answers are one plain line: "412 Precondition Failed". */
export function fail(res: ServerResponse, status: number, headers: OutgoingHttpHeaders = {}): void {
  reply(
    res,
    status,
    { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
    `${status} ${STATUS_CODES[status]}\n`,
  )
}
