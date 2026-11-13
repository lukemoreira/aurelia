// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

const main = join(import.meta.dirname, '..', 'src', 'main.ts')

describe('loadConfig', () => {
  it('needs both Access values', () => {
    expect(() => loadConfig([], {})).toThrow(/CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD/)
    expect(() => loadConfig([], { CF_ACCESS_TEAM_DOMAIN: 'a.cloudflareaccess.com' })).toThrow()
    expect(() => loadConfig([], { CF_ACCESS_AUD: 'x' })).toThrow()
    expect(() => loadConfig([], { CF_ACCESS_TEAM_DOMAIN: ' ', CF_ACCESS_AUD: 'x' })).toThrow()
  })
  it('takes the team domain with or without https://', () => {
    const env = { CF_ACCESS_AUD: 'x' }
    expect(
      loadConfig([], { ...env, CF_ACCESS_TEAM_DOMAIN: 'a.cloudflareaccess.com' }).access,
    ).toEqual({
      teamDomain: 'a.cloudflareaccess.com',
      aud: 'x',
    })
    expect(
      loadConfig([], { ...env, CF_ACCESS_TEAM_DOMAIN: 'https://a.cloudflareaccess.com/' }).access
        ?.teamDomain,
    ).toBe('a.cloudflareaccess.com')
    expect(() => loadConfig([], { ...env, CF_ACCESS_TEAM_DOMAIN: 'a.com/evil?x' })).toThrow(
      /host name/,
    )
  })
  it('pins the team domain to <team>.cloudflareaccess.com', () => {
    for (const d of [
      'evil.com',
      'a.cloudflareaccess.com.evil.com',
      'cloudflareaccess.com',
      'a.b.cloudflareaccess.com',
      'localhost',
    ])
      expect(() => loadConfig([], { CF_ACCESS_AUD: 'x', CF_ACCESS_TEAM_DOMAIN: d }), d).toThrow(
        /myteam\.cloudflareaccess\.com/,
      )
  })
  it('only AURELIA_STORE_INSECURE_NO_AUTH=1 switches the login off', () => {
    expect(loadConfig([], { AURELIA_STORE_INSECURE_NO_AUTH: '1' }).access).toBeNull()
    expect(() => loadConfig([], { AURELIA_STORE_INSECURE_NO_AUTH: 'true' })).toThrow()
    expect(() => loadConfig([], { AURELIA_STORE_INSECURE_NO_AUTH: '0' })).toThrow()
  })
  it('reads --port and --root, then the environment, then the defaults', () => {
    const env = { AURELIA_STORE_INSECURE_NO_AUTH: '1' }
    expect(loadConfig(['--port', '9000', '--root', '/x'], env)).toMatchObject({
      port: 9000,
      root: '/x',
    })
    expect(loadConfig([], { ...env, PORT: '7000', AURELIA_STORE_ROOT: '/y' })).toMatchObject({
      port: 7000,
      root: '/y',
    })
    expect(loadConfig([], env)).toMatchObject({ port: 8081, root: '/data', host: '0.0.0.0' })
    expect(() => loadConfig(['--port', 'abc'], env)).toThrow(/bad port/)
  })
})

describe('starting the program', () => {
  const run = async (env: Record<string, string>) => {
    const root = await mkdtemp(join(tmpdir(), 'aurelia-main-'))
    return spawnSync(process.execPath, [main, '--port', '0', '--root', root], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      timeout: 1500,
      killSignal: 'SIGKILL',
    })
  }
  it('refuses to start without the Access values (fails closed)', async () => {
    const r = await run({})
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required/)
    expect(r.stdout).not.toMatch(/listening/)
  })
  it('starts with the insecure switch, and says so loudly', async () => {
    const r = await run({ AURELIA_STORE_INSECURE_NO_AUTH: '1' })
    // It keeps running until the timeout kills it.
    expect(r.signal).toBe('SIGKILL')
    expect(r.stderr).toMatch(/WARNING: AURELIA_STORE_INSECURE_NO_AUTH=1/)
    expect(r.stdout).toMatch(/aurelia-store listening on \d+/)
  })
  it('starts with the Access values', async () => {
    const r = await run({ CF_ACCESS_TEAM_DOMAIN: 'a.cloudflareaccess.com', CF_ACCESS_AUD: 'x' })
    expect(r.signal).toBe('SIGKILL')
    expect(r.stdout).toMatch(/listening/)
  })
})
