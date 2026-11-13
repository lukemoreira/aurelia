// SPDX-License-Identifier: AGPL-3.0-or-later

/** A failure that maps to one HTTP status. Anything else becomes a 500. */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message = '') {
    super(message)
    this.status = status
  }
}
