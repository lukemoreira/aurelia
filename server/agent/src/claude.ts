// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the unmodified Claude Code program for one person (ADR-0015). Each person has their own folder:
// Claude Code keeps their sign-in there, written by its own login. Aurelia never reads it, and no
// other person's request ever runs with it.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { SYSTEM_PROMPT } from './prompt.ts'
import { ALLOWED_TOOLS, SERVER_NAME } from './tools.ts'

export type ClaudeState = 'not-installed' | 'signed-out' | 'signed-in'

/** Where Claude Code is installed (by Anthropic's installer, at start) inside the data volume. */
export const installHome = (data: string) => join(data, 'claude')
export const binOf = (data: string) => join(installHome(data), '.local', 'bin', 'claude')

/** A folder name for one person: a hash of their address, never the address itself. */
export const userKey = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
export const homeOf = (data: string, email: string) => join(data, 'users', userKey(email))

/**
 * The environment Claude Code runs with: built from nothing, so no login of the container (an API key or
 * token in its environment) can reach anyone's run. HOME and CLAUDE_CONFIG_DIR are the person's own.
 */
export function childEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, 'config'),
    LANG: 'C.UTF-8',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
    // The version is pinned by the image (CLAUDE_CODE_VERSION) and installed once for everyone.
    DISABLE_UPDATES: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  }
}

async function prepare(data: string, email: string) {
  const home = homeOf(data, email)
  await mkdir(join(home, 'config'), { recursive: true, mode: 0o700 })
  await mkdir(join(home, 'work'), { recursive: true, mode: 0o700 })
  return home
}

function run(data: string, home: string, args: string[], stdio: 'pipe' | 'ignore' = 'pipe') {
  const child = spawn(binOf(data), args, { cwd: join(home, 'work'), env: childEnv(home), stdio })
  // A child that dies before it has read its input (EPIPE) must not take the server, and everyone's runs, down.
  child.stdin?.on('error', () => undefined)
  return child
}

const exitOf = (child: ChildProcess) =>
  new Promise<number>((resolve) => {
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code ?? -1))
  })

/** Signed in or not, as Claude Code's own `auth status` says by its exit code. Its output is not read. */
export async function claudeState(data: string, email: string): Promise<ClaudeState> {
  if (!existsSync(binOf(data))) return 'not-installed'
  const home = await prepare(data, email)
  return (await exitOf(run(data, home, ['auth', 'status'], 'ignore'))) === 0
    ? 'signed-in'
    : 'signed-out'
}

/**
 * Claude Code's own login (`claude auth login`), for this person. The caller relays its output to the
 * person and their typed lines to its input, unread. `console` picks the Anthropic Console sign-in.
 */
export async function startLogin(
  data: string,
  email: string,
  console = false,
): Promise<ChildProcess> {
  const home = await prepare(data, email)
  return run(data, home, ['auth', 'login', ...(console ? ['--console'] : [])])
}

/** Claude Code's own logout for this person. */
export async function logout(data: string, email: string): Promise<boolean> {
  if (!existsSync(binOf(data))) return false
  const home = await prepare(data, email)
  return (await exitOf(run(data, home, ['auth', 'logout'], 'ignore'))) === 0
}

/** What the panel is told while Claude Code works. */
export type AgentEvent =
  | { t: 'text'; text: string }
  | { t: 'tool'; label: string }
  | { t: 'end'; ok: boolean; error?: string }

interface Block {
  type?: string
  text?: string
  content?: unknown
}

/** One line of Claude Code's `stream-json` output, as events. Lines it does not know say nothing. */
export function eventsOf(line: string): AgentEvent[] {
  let msg: {
    type?: string
    subtype?: string
    is_error?: boolean
    result?: unknown
    message?: { content?: unknown }
  }
  try {
    msg = JSON.parse(line)
  } catch {
    return []
  }
  const blocks = Array.isArray(msg.message?.content) ? (msg.message.content as Block[]) : []
  if (msg.type === 'assistant')
    return blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim())
      .map((b) => ({ t: 'text', text: b.text! }))
  if (msg.type === 'user')
    // A tool result's first part is the tool's own line for the activity log (see mcp.ts).
    return blocks.flatMap((b) => {
      const first = Array.isArray(b.content) ? (b.content[0] as Block | undefined) : undefined
      return b.type === 'tool_result' && typeof first?.text === 'string'
        ? [{ t: 'tool' as const, label: first.text.slice(0, 200) }]
        : []
    })
  if (msg.type === 'result') {
    const ok = msg.subtype === 'success' && !msg.is_error
    return [
      ok
        ? { t: 'end', ok }
        : {
            t: 'end',
            ok,
            error:
              typeof msg.result === 'string' && msg.result
                ? msg.result
                : 'The assistant stopped before it finished.',
          },
    ]
  }
  return []
}

const MCP_ENTRY = fileURLToPath(new URL('./mcp.ts', import.meta.url))
const REGISTER = fileURLToPath(new URL('./register.ts', import.meta.url))
const RUN_LIMIT_MS = 10 * 60_000

export interface AskOptions {
  prompt: string
  storeUrl: string
  folder: string
  /** The person's own Cloudflare Access token: the tools reach the store as them. */
  token: string
  signal?: AbortSignal
}

/**
 * One question: `claude -p` with no built-in tools, only Aurelia's MCP server (strict: nothing else is
 * loaded), no settings files, no session kept on disk. The prompt goes in on stdin, not on the command line.
 */
export async function* ask(data: string, email: string, o: AskOptions): AsyncGenerator<AgentEvent> {
  const home = await prepare(data, email)
  // The MCP config holds the person's token, so it lives on the tmpfs, readable by this user alone, for one run.
  const dir = await mkdtemp(join(tmpdir(), 'aurelia-run-'))
  const config = join(dir, 'mcp.json')
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        [SERVER_NAME]: {
          type: 'stdio',
          command: process.execPath,
          args: ['--import', REGISTER, MCP_ENTRY],
          env: {
            AURELIA_STORE_URL: o.storeUrl,
            AURELIA_FOLDER: o.folder,
            AURELIA_ACCESS_JWT: o.token,
          },
        },
      },
    }),
    { mode: 0o600 },
  )
  const child = run(data, home, [
    '-p',
    '--tools',
    '',
    '--allowedTools',
    ALLOWED_TOOLS.join(','),
    '--strict-mcp-config',
    '--mcp-config',
    config,
    '--setting-sources',
    '',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-turns',
    '40',
    '--system-prompt',
    SYSTEM_PROMPT,
  ])
  const stop = () => child.kill('SIGTERM')
  const timer = setTimeout(stop, RUN_LIMIT_MS)
  o.signal?.addEventListener('abort', stop)
  if (o.signal?.aborted) stop() // asked to stop before anyone was listening
  const exited = exitOf(child)
  child.stdin!.end(o.prompt)
  child.stderr!.resume() // never shown: it can hold the program's own diagnostics
  let ended = false
  try {
    for await (const line of createInterface({ input: child.stdout! }))
      for (const e of eventsOf(line)) {
        if (e.t === 'end') ended = true
        yield e
      }
    if ((await exited) !== 0 && !ended)
      yield { t: 'end', ok: false, error: 'The assistant stopped before it finished.' }
    else if (!ended) yield { t: 'end', ok: true }
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', stop)
    stop()
    await rm(dir, { recursive: true, force: true })
  }
}
