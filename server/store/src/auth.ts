// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IncomingMessage } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export type Authenticator = (req: IncomingMessage) => Promise<boolean>

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
 * once per cooldown), `iss`, `aud`, a required `exp`, and `nbf` (30 s leeway). Never throws: a bad token is `false`.
 */
export function createAccessAuthenticator(opts: AccessOptions): Authenticator {
  const issuer = `https://${opts.teamDomain}`
  const keys = createRemoteJWKSet(opts.jwksUrl ?? new URL(`${issuer}/cdn-cgi/access/certs`), {
    cooldownDuration: opts.cooldownMs ?? 30_000,
    timeoutDuration: 5_000,
  })
  return async (req) => {
    const token = req.headers['cf-access-jwt-assertion']
    if (typeof token !== 'string' || token === '') return false
    try {
      await jwtVerify(token, keys, {
        issuer,
        audience: opts.aud,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
        clockTolerance: 30,
      })
      return true
    } catch {
      return false
    }
  }
}
