// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's HTTP side, at /agent/ on the app's own address (nginx sends it here). Every request but
// /agent/healthz needs a valid Cloudflare Access login; the person is told apart by its `email` claim.
import type { ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Authenticator } from '../../store/src/auth.ts'
import { ask, claudeState, logout, startLogin, userKey, type AgentEvent } from './claude.ts'
import { buildPrompt, type Turn } from './prompt.ts'
import { checkFolder } from './workspace.ts'

export interface AgentOptions {
  authenticate: Authenticator
  /** The data volume: Claude Code's install and each person's own folder. */
  data: string
  /** The store's WebDAV root inside the container network, e.g. http://aurelia-store:8081/dav/ */
  storeUrl: string
  log?: (line: string) => void
  /** How often a quiet stream sends a blank line (default 30 s). */
  keepAliveMs?: number
}

const BODY_LIMIT = 256 * 1024
const LOGIN_LIMIT_MS = 10 * 60_000

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new HttpError(413, 'Too long.')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {
    // below
  }
  throw new HttpError(400, 'Not JSON.')
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * A stream of JSON lines, sent as they come (nginx is told not to buffer). A blank line every so often
 * keeps a quiet stream open: Cloudflare closes one that says nothing for 100 s, and a sign-in waiting
 * for its code, or a long answer, can be that quiet. The app skips blank lines.
 */
function stream(res: ServerResponse, keepAliveMs: number) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  const beat = setInterval(() => res.write('\n'), keepAliveMs)
  res.on('close', () => clearInterval(beat))
  return (event: unknown) => res.write(`${JSON.stringify(event)}\n`)
}

const history = (raw: unknown): Turn[] =>
  Array.isArray(raw)
    ? raw.flatMap((t) =>
        t && (t.role === 'author' || t.role === 'assistant') && typeof t.text === 'string'
          ? [{ role: t.role, text: t.text }]
          : [],
      )
    : []

export function createAgentServer({
  authenticate,
  data,
  storeUrl,
  log = console.log,
  keepAliveMs = 30_000,
}: AgentOptions): Server {
  /** One login and one question at a time per person, keyed like their folder. */
  const logins = new Map<string, ChildProcess>()
  const busy = new Set<string>()

  async function route(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? ''
    if (path === '/agent/healthz' && (method === 'GET' || method === 'HEAD'))
      return json(res, 200, { ok: true })
    const claims = await authenticate(req)
    const email = typeof claims?.email === 'string' ? claims.email.trim() : ''
    if (!email) return json(res, 401, { error: 'Sign in again.' })
    const key = userKey(email)

    if (path === '/agent/status' && method === 'GET')
      return json(res, 200, { state: await claudeState(data, email) })

    if (path === '/agent/login' && method === 'POST') {
      const body = await readJson(req)
      logins.get(key)?.kill('SIGTERM')
      const child = await startLogin(data, email, body.console === true)
      logins.set(key, child)
      const send = stream(res, keepAliveMs)
      const timer = setTimeout(() => child.kill('SIGTERM'), LOGIN_LIMIT_MS)
      // Claude Code's own words, passed on as they come: never read, kept or logged here.
      const relay = (chunk: Buffer) => send({ t: 'out', text: chunk.toString('utf8') })
      child.stdout?.on('data', relay)
      child.stderr?.on('data', relay)
      child.on('error', () => undefined)
      res.on('close', () => child.kill('SIGTERM'))
      child.on('close', (code) => {
        clearTimeout(timer)
        if (logins.get(key) === child) logins.delete(key)
        send({ t: 'end', ok: code === 0 })
        res.end()
      })
      return
    }

    if (path === '/agent/login/input' && method === 'POST') {
      const { text } = await readJson(req)
      const child = logins.get(key)
      if (typeof text !== 'string' || text.length > 4096 || /[\r\n]/.test(text))
        return json(res, 400, { error: 'One line, please.' })
      if (!child?.stdin?.writable) return json(res, 409, { error: 'No sign-in is waiting.' })
      // What the person typed, as typed, to Claude Code's own prompt. Not kept, not logged.
      child.stdin.write(`${text}\n`)
      return json(res, 200, { ok: true })
    }

    if (path === '/agent/logout' && method === 'POST') {
      logins.get(key)?.kill('SIGTERM')
      return json(res, 200, { ok: await logout(data, email) })
    }

    if (path === '/agent/ask' && method === 'POST') {
      const body = await readJson(req)
      const folder = checkFolder(body.folder)
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (!message || message.length > 20_000) return json(res, 400, { error: 'Write a message.' })
      if (busy.has(key)) return json(res, 409, { error: 'The assistant is still answering.' })
      busy.add(key)
      const abort = new AbortController()
      res.on('close', () => abort.abort())
      const send = stream(res, keepAliveMs)
      try {
        const context = typeof body.context === 'string' ? body.context.slice(0, 500) : ''
        for await (const e of ask(data, email, {
          prompt: buildPrompt(message, history(body.history), context),
          storeUrl,
          folder,
          token: String(req.headers['cf-access-jwt-assertion']),
          signal: abort.signal,
        }))
          send(e satisfies AgentEvent)
      } catch {
        send({ t: 'end', ok: false, error: 'The assistant could not start.' })
      } finally {
        busy.delete(key)
        res.end()
      }
      return
    }
    return json(res, 404, { error: 'Not here.' })
  }

  return createServer(async (req, res) => {
    const started = performance.now()
    const path = new URL(req.url ?? '/', 'http://agent.invalid').pathname
    // Method, path, status, duration. Never a token, an address, a message or what Claude Code says.
    res.on('finish', () =>
      log(`${req.method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`),
    )
    try {
      await route(req, res, path)
    } catch (e) {
      if (res.headersSent) return void res.end()
      const status =
        e instanceof HttpError
          ? e.status
          : e instanceof Error && e.name === 'StorageError'
            ? 400
            : 500
      json(res, status, { error: status === 500 ? 'Something went wrong.' : (e as Error).message })
    }
  })
}
