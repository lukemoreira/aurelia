// SPDX-License-Identifier: AGPL-3.0-or-later
// The address a book's website field may be followed to: http or https only, never any other scheme.

/** `host:port` (a bare domain with a port) looks like a scheme to a quick check, and is not one. */
const HOST_PORT = /^[^\s/:@]+:\d+(?:[/?#]|$)/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Where a typed web address goes: the `https:`/`http:` address itself, a bare domain (`example.com`)
 * as `https://example.com`, and nothing for anything else (`javascript:`, `mailto:`, a file, plain words).
 */
export function websiteLink(typed: string | undefined): string | undefined {
  const text = typed?.trim()
  if (!text || /\s/.test(text)) return undefined
  const explicit = /^https?:\/\//i.test(text)
  if (!explicit && (!/^[a-z0-9]/i.test(text) || (SCHEME.test(text) && !HOST_PORT.test(text))))
    return undefined
  try {
    const url = new URL(explicit ? text : `https://${text}`)
    const ok = url.protocol === 'https:' || url.protocol === 'http:'
    return ok && url.hostname.includes('.') ? url.href : undefined
  } catch {
    return undefined
  }
}
