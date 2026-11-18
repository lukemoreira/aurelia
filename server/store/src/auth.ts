// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IncomingMessage } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'

/** The verified token's claims (Cloudflare puts the signed-in person's `email` there), or null. */
export type Authenticator = (req: IncomingMessage) => Promise<JWTPayload | null>

export interface AccessOptions {
  /** e.g. `myteam.cloudflareaccess.com` */
  teamDomain: string
  /** The Access application's AUD tag. */
  aud: string
  /** Tests only. In production the keys come from the team's own certs URL. */
  jwksUrl?: URL
  /** Least time between two key fetches caused by an unknown `kid`. */
  cooldownMs?: number
}

/**
 * Checks the `Cf-Access-Jwt-Assertion` header Cloudflare adds at its edge: RS256 signature
 * against the team's keys (cached; fetched again when a token names an unknown key, at most
 * once per cooldown), `iss`, `aud`, a required `exp`, and `nbf` (30 s leeway). Never throws: a bad token is `null`.
 * Shared with the assistant server (server/agent), which needs the `email` claim to tell people apart.
 */
export function createAccessAuthenticator(opts: AccessOptions): Authenticator {
  const issuer = `https://${opts.teamDomain}`
  const keys = createRemoteJWKSet(opts.jwksUrl ?? new URL(`${issuer}/cdn-cgi/access/certs`), {
    cooldownDuration: opts.cooldownMs ?? 30_000,
    timeoutDuration: 5_000,
  })
  return async (req) => {
    const token = req.headers['cf-access-jwt-assertion']
    if (typeof token !== 'string' || token === '') return null
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: opts.aud,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
        clockTolerance: 30,
      })
      return payload
    } catch {
      return null
    }
  }
}
