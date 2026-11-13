// SPDX-License-Identifier: AGPL-3.0-or-later

const encoder = new TextEncoder()
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

export const encode = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text)

/** The one content hash: SHA-256 of the bytes on disk. Compare-and-write rests on it. */
export async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

/** Hash of the UTF-8 bytes a text is written as, so a saved text hashes like the file it became. */
export const hashText = (text: string) => hashBytes(encode(text))
