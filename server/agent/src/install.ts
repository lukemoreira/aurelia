// SPDX-License-Identifier: AGPL-3.0-or-later
// Claude Code is not part of Aurelia's image: the container installs it at start, with Anthropic's own
// installer, into the data volume (ADR-0015). Aurelia ships no Anthropic code.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { binOf, installHome } from './claude.ts'

/** Anthropic's documented install command, pinned to one version (https://code.claude.com/docs/en/setup). */
export const INSTALL_COMMAND =
  'curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_CODE_VERSION"'

export const isInstalled = (data: string, version: string) =>
  existsSync(binOf(data)) &&
  existsSync(join(installHome(data), '.local', 'share', 'claude', 'versions', version))

/** Install the pinned version unless it is there. Resolves true when it is installed afterwards. */
export async function ensureInstalled(
  data: string,
  version: string,
  log: (line: string) => void,
): Promise<boolean> {
  if (isInstalled(data, version)) return true
  const home = installHome(data)
  await mkdir(home, { recursive: true })
  log(`installing Claude Code ${version} with Anthropic's installer`)
  const code = await new Promise<number>((resolve) => {
    const child = spawn('bash', ['-c', INSTALL_COMMAND], {
      env: { PATH: process.env.PATH ?? '', HOME: home, CLAUDE_CODE_VERSION: version },
      stdio: 'ignore',
    })
    child.on('error', () => resolve(-1))
    child.on('close', (c) => resolve(c ?? -1))
  })
  const ok = code === 0 && isInstalled(data, version)
  log(ok ? `Claude Code ${version} installed` : `Claude Code install failed (exit ${code})`)
  return ok
}
