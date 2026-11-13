// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage: node src/main.ts [--port 8081] [--root /data] [--host 0.0.0.0]
import { realpath } from 'node:fs/promises'
import { createAccessAuthenticator } from './auth.ts'
import { loadConfig } from './config.ts'
import { createStoreServer } from './server.ts'
import { sweepTemp } from './sweep.ts'

try {
  const config = loadConfig(process.argv.slice(2), process.env)
  if (!config.access)
    console.warn(
      'WARNING: AURELIA_STORE_INSECURE_NO_AUTH=1. Anyone who can reach this port can read and delete the books. Tests only.',
    )
  const realRoot = await realpath(config.root)
  const swept = await sweepTemp(realRoot).catch(() => 0)
  if (swept) console.log(`removed ${swept} old temp file(s)`)
  const server = createStoreServer({
    realRoot,
    authenticate: config.access ? createAccessAuthenticator(config.access) : null,
  })
  server.listen(config.port, config.host, () => {
    const addr = server.address()
    console.log(
      `aurelia-store listening on ${typeof addr === 'object' && addr ? addr.port : addr}, root ${realRoot}`,
    )
  })
  // PID 1 in a container gets no default SIGTERM handling from Node.
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.on(sig, () => {
      server.close(() => process.exit(0))
      server.closeAllConnections()
    })
} catch (e) {
  console.error(`aurelia-store: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
