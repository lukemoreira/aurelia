// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant server at /agent/ (ADR-0015), on the app's own address: the Cloudflare Access login goes
// along, so it knows who is asking. It is optional: no server, no assistant, and nothing else changes.

/** `absent`: no assistant on this server. `sign-in-again`: the Cloudflare login ran out. */
export type AgentState = 'absent' | 'sign-in-again' | 'not-installed' | 'signed-out' | 'signed-in'

export type AskEvent =
  | { t: 'text'; text: string }
  | { t: 'tool'; label: string }
  | { t: 'end'; ok: boolean; error?: string }
export type LoginEvent = { t: 'out'; text: string } | { t: 'end'; ok: boolean }

export interface AskBody {
  /** The synced folder on the server, which the assistant reads. */
  folder: string
  message: string
  history: { role: 'author' | 'assistant'; text: string }[]
  /** What the author has open, in words. */
  context: string
}

type Fetch = typeof fetch
const init = (body?: object): RequestInit => ({
  method: body ? 'POST' : 'GET',
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body && JSON.stringify(body),
  credentials: 'same-origin',
  cache: 'no-store',
  // A redirect is the Cloudflare login page: never followed.
  redirect: 'manual',
})
const signedOut = (res: Response) => res.type === 'opaqueredirect' || res.status === 401

export async function agentState(fetchImpl: Fetch = fetch): Promise<AgentState> {
  try {
    const res = await fetchImpl('/agent/status', init())
    if (signedOut(res)) return 'sign-in-again'
    if (!res.ok || !res.headers.get('Content-Type')?.includes('json')) return 'absent'
    const { state } = (await res.json()) as { state?: string }
    return state === 'not-installed' || state === 'signed-out' || state === 'signed-in'
      ? state
      : 'absent'
  } catch {
    return 'absent'
  }
}

/** One JSON object per line, as the server sends them. */
async function* lines<T>(res: Response): AsyncGenerator<T> {
  if (signedOut(res)) throw new Error('Sign in again: the server asked for your login.')
  if (!res.ok || !res.body) {
    const why = await res.json().catch(() => null)
    throw new Error((why as { error?: string } | null)?.error ?? 'The assistant did not answer.')
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let held = ''
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    held += r.value
    const parts = held.split('\n')
    held = parts.pop()!
    for (const p of parts) if (p.trim()) yield JSON.parse(p) as T
  }
  if (held.trim()) yield JSON.parse(held) as T
}

export async function* askAgent(body: AskBody, signal?: AbortSignal, fetchImpl: Fetch = fetch) {
  yield* lines<AskEvent>(await fetchImpl('/agent/ask', { ...init(body), signal }))
}

/** Claude Code's own sign-in, relayed: its words come back as they are, unread. */
export async function* loginAgent(
  useConsole: boolean,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
) {
  yield* lines<LoginEvent>(
    await fetchImpl('/agent/login', { ...init({ console: useConsole }), signal }),
  )
}

/** A line the person typed into Claude Code's sign-in (the code it asks for), sent as it is. */
export async function sendLoginLine(text: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  return (await fetchImpl('/agent/login/input', init({ text }))).ok
}

export async function logoutAgent(fetchImpl: Fetch = fetch): Promise<boolean> {
  const res = await fetchImpl('/agent/logout', init({}))
  return res.ok && ((await res.json()) as { ok?: boolean }).ok === true
}
