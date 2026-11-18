// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage: node --import ./src/register.ts src/main.ts
import { createAccessAuthenticator } from '../../store/src/auth.ts'
import { accessFromEnv } from '../../store/src/config.ts'
import { ensureInstalled } from './install.ts'
import { createAgentServer } from './server.ts'

const RETRY_MS = 10 * 60_000

try {
  const env = process.env
  const access = accessFromEnv(env)
  const port = Number(env.PORT ?? 8082)
  const data = env.AURELIA_AGENT_DATA ?? '/data'
  const storeUrl = env.AURELIA_STORE_URL ?? 'http://aurelia-store:8081/dav/'
  const version = env.CLAUDE_CODE_VERSION
  if (!version) throw new Error('CLAUDE_CODE_VERSION is required (the image sets it).')
  // No one's login is ever taken from the environment (ADR-0015): each person signs in for themselves.
  for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
    if (env[name])
      console.warn(`${name} is set and is ignored: every person signs in with their own account.`)
  const install = () =>
    void ensureInstalled(data, version, console.log).then(
      (ok) => ok || setTimeout(install, RETRY_MS),
      () => setTimeout(install, RETRY_MS),
    )
  // The smoke test (deploy/smoke-agent.sh) checks the image without fetching anything from Anthropic.
  if (env.AURELIA_AGENT_SKIP_INSTALL !== '1') install()
  const server = createAgentServer({
    authenticate: createAccessAuthenticator(access),
    data,
    storeUrl,
  })
  server.listen(port, env.AURELIA_AGENT_HOST ?? '0.0.0.0', () =>
    console.log(`aurelia-agent listening on ${port}`),
  )
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.on(sig, () => {
      server.close(() => process.exit(0))
      server.closeAllConnections()
    })
} catch (e) {
  console.error(`aurelia-agent: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
