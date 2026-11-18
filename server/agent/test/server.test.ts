// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ask, binOf, eventsOf, homeOf } from '../src/claude.ts'
import { createAgentServer, stream } from '../src/server.ts'
import { ALLOWED_TOOLS } from '../src/tools.ts'
import { FOLDER } from './helpers.ts'

/**
 * A stand-in for the Claude Code program: the same commands, a login that asks for a code, and a `-p` that
 * notes what it was started with (in the person's own HOME) and answers in stream-json.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path')
const [cmd, sub] = process.argv.slice(2)
const flag = path.join(process.env.CLAUDE_CONFIG_DIR, '.signed-in')
if (cmd === 'auth' && sub === 'status') process.exit(fs.existsSync(flag) ? 0 : 1)
if (cmd === 'auth' && sub === 'logout') { fs.rmSync(flag, { force: true }); process.exit(0) }
if (cmd === 'auth' && sub === 'login') {
  process.stdout.write('If the browser didn\\'t open, visit: https://claude.example/oauth\\nPaste code here if prompted > ')
  process.stdin.once('data', (d) => {
    if (String(d) === 'good-code\\n') { fs.writeFileSync(flag, ''); console.log('Login successful'); process.exit(0) }
    console.log('Invalid code'); process.exit(1)
  })
} else if (cmd === '-p' && fs.existsSync(path.join(path.dirname(process.argv[1]), 'die'))) {
  process.exit(3) // dies at once, its input never read
} else if (cmd === '-p' && fs.existsSync(path.join(path.dirname(process.argv[1]), 'hang'))) {
  setTimeout(() => {}, 60_000) // answers nothing until it is stopped
} else if (cmd === '-p') {
  let prompt = ''
  process.stdin.on('data', (d) => (prompt += d))
  process.stdin.on('end', () => {
    fs.appendFileSync(path.join(process.env.HOME, 'runs.jsonl'), JSON.stringify({ argv: process.argv.slice(2), env: process.env, prompt }) + '\\n')
    const out = (o) => console.log(JSON.stringify(o))
    out({ type: 'system', subtype: 'init', tools: [] })
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__aurelia__get_scene', input: {} }] } })
    out({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'Read 1.1 The Customs House' }, { type: 'text', text: 'data' }] }] } })
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Tomas is in two places.' }] } })
    setTimeout(() => { out({ type: 'result', subtype: 'success', is_error: false, result: 'done' }); process.exit(0) }, fs.existsSync(path.join(path.dirname(process.argv[1]), 'slow')) ? 400 : 0)
  })
}
`

const PEOPLE: Record<string, string> = {
  'jwt-alice': 'alice@example.com',
  'jwt-bob': 'Bob@Example.com',
}
let data: string
let server: Server
let base: string

beforeEach(async () => {
  data = await realpath(await mkdtemp(join(tmpdir(), 'aurelia-agent-data-')))
  server = createAgentServer({
    authenticate: async (req: IncomingMessage) => {
      const email = PEOPLE[String(req.headers['cf-access-jwt-assertion'])]
      return email ? { email } : null
    },
    data,
    storeUrl: 'http://store.invalid/dav/',
    log: () => undefined,
    keepAliveMs: 100,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

async function install() {
  await mkdir(dirname(binOf(data)), { recursive: true })
  await writeFile(binOf(data), FAKE_CLAUDE)
  await chmod(binOf(data), 0o755)
}
const call = (path: string, jwt: string | null, body?: object) =>
  fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  })
const state = async (jwt: string) =>
  ((await (await call('/agent/status', jwt)).json()) as { state: string }).state
const lines = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { t: string; text?: string; label?: string; ok?: boolean })
const runs = async (email: string) =>
  (await readFile(join(homeOf(data, email), 'runs.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { argv: string[]; env: Record<string, string>; prompt: string })

describe('login check', () => {
  it('refuses a missing or forged Cloudflare Access login on every route; /agent/healthz needs none', async () => {
    for (const jwt of [null, 'forged']) {
      expect((await call('/agent/status', jwt)).status).toBe(401)
      expect((await call('/agent/login', jwt, {})).status).toBe(401)
      expect((await call('/agent/ask', jwt, { folder: FOLDER, message: 'hi' })).status).toBe(401)
      expect((await call('/agent/logout', jwt, {})).status).toBe(401)
    }
    expect((await call('/agent/healthz', null)).status).toBe(200)
  })
})

describe('each person signs in with their own Claude account', () => {
  it('says "not installed" before Claude Code is there', async () => {
    expect(await state('jwt-alice')).toBe('not-installed')
  })

  it('relays Claude Code’s own login and the typed code, in that person’s folder only', async () => {
    await install()
    expect(await state('jwt-alice')).toBe('signed-out')
    const login = await call('/agent/login', 'jwt-alice', {})
    const reader = login.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('https://claude.example/oauth') // the program's own words, passed on
    expect((await call('/agent/login/input', 'jwt-bob', { text: 'good-code' })).status).toBe(409) // not Bob's login
    expect((await call('/agent/login/input', 'jwt-alice', { text: 'a\nb' })).status).toBe(400)
    expect((await call('/agent/login/input', 'jwt-alice', { text: 'good-code' })).status).toBe(200)
    let rest = ''
    for (let r = await reader.read(); !r.done; r = await reader.read())
      rest += new TextDecoder().decode(r.value)
    expect(rest).toContain('Login successful')
    expect(rest).toContain('"t":"end","ok":true')
    expect(await state('jwt-alice')).toBe('signed-in')
    expect(await state('jwt-bob')).toBe('signed-out') // Alice's sign-in is hers alone
    expect(homeOf(data, 'alice@example.com')).not.toBe(homeOf(data, 'Bob@Example.com'))
    expect(homeOf(data, 'ALICE@example.com ')).toBe(homeOf(data, 'alice@example.com'))
    expect(homeOf(data, 'alice@example.com')).not.toContain('alice')
    expect(await (await call('/agent/logout', 'jwt-alice', {})).json()).toEqual({ ok: true })
    expect(await state('jwt-alice')).toBe('signed-out')
  })
})

describe('asking', () => {
  it('runs Claude Code with only Aurelia’s tools, in the asker’s own folder, never another’s, and streams the answer', async () => {
    await install()
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'must-never-reach-a-run'
    process.env.ANTHROPIC_API_KEY = 'must-never-reach-a-run'
    try {
      const events = await lines(
        await call('/agent/ask', 'jwt-alice', { folder: FOLDER, message: 'Check Tomas.' }),
      )
      expect(events).toEqual([
        { t: 'tool', label: 'Read 1.1 The Customs House' },
        { t: 'text', text: 'Tomas is in two places.' },
        { t: 'end', ok: true },
      ])
      await lines(await call('/agent/ask', 'jwt-bob', { folder: FOLDER, message: 'Hello.' }))
    } finally {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      delete process.env.ANTHROPIC_API_KEY
    }
    const [alice] = await runs('alice@example.com')
    const [bob] = await runs('Bob@Example.com')
    expect(alice!.env.HOME).toBe(homeOf(data, 'alice@example.com'))
    expect(alice!.env.CLAUDE_CONFIG_DIR).toBe(join(homeOf(data, 'alice@example.com'), 'config'))
    expect(bob!.env.CLAUDE_CONFIG_DIR).toBe(join(homeOf(data, 'Bob@Example.com'), 'config'))
    for (const run of [alice!, bob!]) {
      expect(run.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(run.env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(run.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
      const a = run.argv
      const after = (f: string) => a[a.indexOf(f) + 1]
      expect(after('--tools')).toBe('')
      expect(after('--allowedTools')).toBe(ALLOWED_TOOLS.join(','))
      expect(after('--setting-sources')).toBe('')
      expect(after('--permission-mode')).toBe('dontAsk')
      expect(after('--output-format')).toBe('stream-json')
      expect(a).toEqual(
        expect.arrayContaining([
          '-p',
          '--strict-mcp-config',
          '--no-session-persistence',
          '--disable-slash-commands',
        ]),
      )
    }
    expect(alice!.prompt).toContain('Check Tomas.')
    expect(ALLOWED_TOOLS.every((t) => t.startsWith('mcp__aurelia__'))).toBe(true)
    expect(ALLOWED_TOOLS).not.toContain('mcp__aurelia__write')
  })

  it('takes one question at a time per person, and refuses a folder that is not a workspace', async () => {
    await install()
    await writeFile(join(dirname(binOf(data)), 'slow'), '')
    {
      const first = call('/agent/ask', 'jwt-alice', { folder: FOLDER, message: 'One.' })
      await new Promise((r) => setTimeout(r, 150))
      expect(
        (await call('/agent/ask', 'jwt-alice', { folder: FOLDER, message: 'Two.' })).status,
      ).toBe(409)
      expect((await first).status).toBe(200)
    }
    expect(
      (await call('/agent/ask', 'jwt-alice', { folder: '../../etc', message: 'x' })).status,
    ).toBe(400)
  })
})

describe('reading Claude Code’s stream', () => {
  it('turns text, tool results and the result into events, and ignores the rest', () => {
    expect(eventsOf('not json')).toEqual([])
    expect(eventsOf(JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual([])
    expect(
      eventsOf(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true })),
    ).toEqual([{ t: 'end', ok: false, error: 'The assistant stopped before it finished.' }])
    expect(
      eventsOf(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Not logged in · Please run /login',
        }),
      ),
    ).toEqual([{ t: 'end', ok: false, error: 'Not logged in · Please run /login' }])
  })
})

describe('a run that goes wrong', () => {
  const opts = { storeUrl: 'http://store.invalid/dav/', folder: FOLDER, token: 't' }
  const all = async (gen: AsyncGenerator<unknown>) => {
    const out: unknown[] = []
    for await (const e of gen) out.push(e)
    return out
  }

  it('a program that dies before reading a 100 KB prompt does not take the server down', async () => {
    await install()
    await writeFile(join(dirname(binOf(data)), 'die'), '')
    const events = await all(
      ask(data, 'alice@example.com', { ...opts, prompt: 'x'.repeat(100_000) }),
    )
    expect(events).toEqual([
      { t: 'end', ok: false, error: 'The assistant stopped before it finished.' },
    ])
    expect((await call('/agent/healthz', null)).status).toBe(200) // still up
  })

  it('stops at once when it was asked to stop before the run began', async () => {
    await install()
    await writeFile(join(dirname(binOf(data)), 'hang'), '')
    const abort = new AbortController()
    abort.abort()
    const started = Date.now()
    const events = await all(
      ask(data, 'alice@example.com', { ...opts, prompt: 'hi', signal: abort.signal }),
    )
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(events).toMatchObject([{ t: 'end', ok: false }])
  })

  it('sends no blank line once the answer has ended, even before the reader has it all', () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      const res = { writeHead: () => res, on: () => res, write, writableEnded: false }
      stream(res as unknown as ServerResponse, 100)
      vi.advanceTimersByTime(100)
      expect(write).toHaveBeenCalledTimes(1)
      res.writableEnded = true // ended, but 'close' has not come yet
      vi.advanceTimersByTime(500)
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('a quiet answer keeps its stream open with blank lines, which the app skips', async () => {
    await install()
    await writeFile(join(dirname(binOf(data)), 'slow'), '')
    const text = await (
      await call('/agent/ask', 'jwt-alice', { folder: FOLDER, message: 'Hi.' })
    ).text()
    expect(text.split('\n').filter((l) => l === '').length).toBeGreaterThan(1)
    expect(text).toContain('"t":"end","ok":true')
  })
})
