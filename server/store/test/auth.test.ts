// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { JWK, CryptoKey } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAccessAuthenticator } from '../src/auth.ts'
import { dav, startStore } from './helpers.ts'
import type { Store } from './helpers.ts'

const TEAM = 'team.example.cloudflareaccess.com'
const AUD = 'aud-tag-1234'

interface Key {
  kid: string
  privateKey: CryptoKey
  jwk: JWK
}
async function makeKey(kid: string): Promise<Key> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  return {
    kid,
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' },
  }
}

/** A local stand-in for https://<team>/cdn-cgi/access/certs, whose keys the test can change. */
let jwks: Server
let published: Key[] = []
let fetches = 0
let jwksUrl: URL
let store: Store | null = null

beforeEach(async () => {
  fetches = 0
  published = [await makeKey('k1')]
  jwks = createServer((_req, res) => {
    fetches++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ keys: published.map((k) => k.jwk) }))
  })
  await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r))
  jwksUrl = new URL(`http://127.0.0.1:${(jwks.address() as AddressInfo).port}/cdn-cgi/access/certs`)
})
afterEach(async () => {
  await store?.close()
  store = null
  jwks.closeAllConnections()
  await new Promise((r) => jwks.close(r))
})

async function token(
  key: Key,
  o: {
    aud?: string | string[]
    iss?: string
    exp?: string | number | null
    nbf?: string | number
    kid?: string
  } = {},
) {
  const jwt = new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: o.kid ?? key.kid })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
  if (o.exp !== null) jwt.setExpirationTime(o.exp ?? '5m')
  if (o.nbf !== undefined) jwt.setNotBefore(o.nbf)
  return jwt.sign(key.privateKey)
}

async function start(cooldownMs = 0) {
  store = await startStore(
    createAccessAuthenticator({ teamDomain: TEAM, aud: AUD, jwksUrl, cooldownMs }),
  )
  return (t?: string) =>
    dav(store!.port, 'GET', '/dav/', {
      headers: t === undefined ? {} : { 'Cf-Access-Jwt-Assertion': t },
    })
}

describe('Cloudflare Access login', () => {
  it('accepts a valid token', async () => {
    const get = await start()
    const r = await get(await token(published[0]!))
    expect(r.status).toBe(405) // past the login: GET on the root folder
  })

  it('refuses a missing or empty token with 401 and a short body', async () => {
    const get = await start()
    for (const t of [undefined, '', 'not.a.jwt', 'garbage']) {
      const r = await get(t)
      expect(r.status, String(t)).toBe(401)
      expect(r.text).toBe('401 Unauthorized\n')
    }
  })

  it('refuses every method without a token, including OPTIONS', async () => {
    await start()
    for (const m of ['OPTIONS', 'GET', 'PUT', 'PROPFIND', 'MKCOL', 'DELETE', 'MOVE', 'POST'])
      expect((await dav(store!.port, m, '/dav/a')).status, m).toBe(401)
  })

  it('refuses a token signed by another key (same kid)', async () => {
    const get = await start()
    const other = await makeKey('k1')
    expect((await get(await token(other))).status).toBe(401)
  })

  it('refuses the wrong audience, the wrong issuer, and an audience list without ours', async () => {
    const get = await start()
    const k = published[0]!
    expect((await get(await token(k, { aud: 'other' }))).status).toBe(401)
    expect((await get(await token(k, { iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(
      401,
    )
    expect((await get(await token(k, { aud: ['a', 'b'] }))).status).toBe(401)
    expect((await get(await token(k, { aud: ['a', AUD] }))).status).toBe(405)
  })

  it('refuses an expired token and a not-yet-valid one, with a small leeway', async () => {
    const get = await start()
    const k = published[0]!
    const now = Math.floor(Date.now() / 1000)
    expect((await get(await token(k, { exp: now - 3600 }))).status).toBe(401)
    expect((await get(await token(k, { nbf: now + 3600 }))).status).toBe(401)
    expect((await get(await token(k, { exp: now - 5 }))).status).toBe(405) // inside the 30 s leeway
  })

  it('refuses a token with no exp (it would never expire)', async () => {
    const get = await start()
    expect((await get(await token(published[0]!, { exp: null }))).status).toBe(401)
  })

  it('refuses a token signed with another algorithm even when its key is in the JWKS', async () => {
    const get = await start()
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
    const es = { ...(await exportJWK(publicKey)), kid: 'e1', alg: 'ES256', use: 'sig' }
    published = [published[0]!, { kid: 'e1', privateKey, jwk: es }]
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'e1' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(privateKey)
    expect((await get(t)).status).toBe(401)
  })

  it('refuses other algorithms (HS256 with the public key as secret, and alg none)', async () => {
    const get = await start()
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(JSON.stringify(published[0]!.jwk)))
    expect((await get(hs)).status).toBe(401)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const none = `${b64({ alg: 'none', kid: 'k1' })}.${b64({ iss: `https://${TEAM}`, aud: AUD, exp: 9999999999 })}.`
    expect((await get(none)).status).toBe(401)
  })

  it('fetches the keys again when a token names an unknown kid', async () => {
    const get = await start(0)
    expect((await get(await token(published[0]!))).status).toBe(405)
    expect(fetches).toBe(1)
    published = [published[0]!, await makeKey('k2')] // Cloudflare rotated its keys
    expect((await get(await token(published[1]!))).status).toBe(405)
    expect(fetches).toBe(2)
  })

  it('a token naming a kid that never appears is 401, and key fetches are rate-limited', async () => {
    const get = await start(60_000)
    const k = published[0]!
    expect((await get(await token(k))).status).toBe(405)
    expect(fetches).toBe(1)
    for (let i = 0; i < 5; i++)
      expect((await get(await token(k, { kid: `nope${i}` }))).status).toBe(401)
    expect(fetches).toBe(1)
    // Known keys keep working from the cache.
    expect((await get(await token(k))).status).toBe(405)
    expect(fetches).toBe(1)
  })

  it('/healthz needs no login', async () => {
    await start()
    expect((await dav(store!.port, 'GET', '/healthz')).status).toBe(200)
  })

  it('logs never contain the token', async () => {
    const lines: string[] = []
    const { createStoreServer } = await import('../src/server.ts')
    const { realpath, mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await realpath(await mkdtemp(join(tmpdir(), 'aurelia-log-')))
    const auth = createAccessAuthenticator({ teamDomain: TEAM, aud: AUD, jwksUrl })
    const srv = createStoreServer({ realRoot: root, authenticate: auth, log: (l) => lines.push(l) })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const t = await token(published[0]!)
    await dav((srv.address() as AddressInfo).port, 'GET', '/dav/x?q=1', {
      headers: { 'Cf-Access-Jwt-Assertion': t },
    })
    srv.closeAllConnections()
    await new Promise((r) => srv.close(r))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^GET \/dav\/x 404 \d+ms$/)
    expect(lines.join('')).not.toContain(t)
  })
})
