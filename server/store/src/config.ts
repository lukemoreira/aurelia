// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Config {
  host: string
  port: number
  root: string
  /** null only with AURELIA_STORE_INSECURE_NO_AUTH=1. */
  access: { teamDomain: string; aud: string } | null
}

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** Fails closed: no Access settings and no explicit insecure switch means the store does not start. */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const port = Number(flag(argv, '--port') ?? env.PORT ?? 8081)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`bad port: ${port}`)
  const base = {
    host: flag(argv, '--host') ?? env.AURELIA_STORE_HOST ?? '0.0.0.0',
    port,
    root: flag(argv, '--root') ?? env.AURELIA_STORE_ROOT ?? '/data',
  }
  if (env.AURELIA_STORE_INSECURE_NO_AUTH === '1') return { ...base, access: null }
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '')
  const aud = env.CF_ACCESS_AUD?.trim()
  if (!teamDomain || !aud)
    throw new Error(
      'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required (the store refuses requests without a valid Cloudflare Access login).',
    )
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain))
    throw new Error('CF_ACCESS_TEAM_DOMAIN must be a host name like myteam.cloudflareaccess.com')
  return { ...base, access: { teamDomain, aud } }
}
