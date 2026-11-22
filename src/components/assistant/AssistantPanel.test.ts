// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import Inspector from '@/components/shell/Inspector.vue'
import { agentState, sendLoginLine } from '@/assistant/client'
import { STOPPED, chatStore, type ChatTurn } from '@/assistant/chat-store'
import { GUIDED_START, useAssistant } from '@/composables/useAssistant'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'
import { fixture, id } from '../../../tests/helpers/index-fixture'

async function inspectorWith(answer: () => Promise<Response>, open = true) {
  vi.stubGlobal('fetch', vi.fn(answer))
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.load(fixture([{ n: 1, title: 'The Gate', body: 'Text.' }], []))
  if (open) ws.select(id('bok', 1), id('scn', 1))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', name: 'write', component: { render: () => null } }],
  })
  await router.push('/write')
  const wrapper = mount(Inspector, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}
const json = (body: object, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
const tabs = (w: Awaited<ReturnType<typeof inspectorWith>>) =>
  w.findAll('[role="tab"]').map((t) => t.attributes('aria-label') ?? t.text())

describe('the assistant’s tab', () => {
  it('is not there when the server runs no assistant (no answer, a 502, or the app’s own page)', async () => {
    expect(tabs(await inspectorWith(() => Promise.reject(new TypeError('offline'))))).not.toContain(
      'Assistant',
    )
    expect(
      tabs(
        await inspectorWith(() => Promise.resolve(new Response('Bad gateway', { status: 502 }))),
      ),
    ).not.toContain('Assistant')
    expect(
      tabs(
        await inspectorWith(() =>
          Promise.resolve(new Response('<html>', { headers: { 'Content-Type': 'text/html' } })),
        ),
      ),
    ).not.toContain('Assistant')
  })

  it('is there when the server runs one, and offers a signed-out person Claude Code’s own sign-in', async () => {
    const w = await inspectorWith(() => json({ state: 'signed-out' }))
    expect(tabs(w)).toContain('Assistant')
    await w.find('[role="tab"][aria-label="Assistant"]').trigger('mousedown')
    await flushPromises()
    expect(w.text()).toContain('Claude Code on this server')
    expect(w.text()).toContain('Start Claude Code sign-in')
  })
})

describe('the guided start (ADR-0016)', () => {
  it('is offered on a book with no story base, and sends the author’s own request, then the base is on the Book tab', async () => {
    const asked: string[] = []
    const w = await inspectorWith(() => json({ state: 'signed-in' }))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === '/agent/ask') {
        asked.push(JSON.parse(String(init?.body)).message)
        return new Response(`${JSON.stringify({ t: 'end', ok: true })}\n`, {
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      }
      return json({ state: 'signed-in' })
    })
    useBackupStore().view = {
      enabled: true,
      mode: 'sync',
      folder: 'Aurelia/W (wsp_abcdefghjk)',
      status: 'idle',
      lastBackup: null,
      error: null,
    } as never
    await w.find('[role="tab"][aria-label="Assistant"]').trigger('mousedown')
    await flushPromises()
    expect(w.text()).toContain('This book has no story base yet')
    const start = w
      .findAll('button')
      .find((b) => b.text() === 'Set up the story base with the assistant')!
    await start.trigger('click')
    await flushPromises()
    expect(asked).toEqual([GUIDED_START])

    await w.find('[role="tab"][aria-label="Book"]').trigger('mousedown')
    await flushPromises()
    const base = w.find('form[aria-label="Story base"]')
    expect(base.text()).toContain('Objectives')
    expect(base.text()).toContain('World and history')
    expect(base.text()).toContain('Main narrative')
    expect(base.text()).toContain('Main characters')
  })
})

describe('the guided start with no book open', () => {
  it('is not offered: there is no book to set up', async () => {
    const w = await inspectorWith(() => json({ state: 'signed-in' }), false)
    useBackupStore().view = {
      enabled: true,
      mode: 'sync',
      folder: 'Aurelia/W (wsp_abcdefghjk)',
      status: 'idle',
      lastBackup: null,
      error: null,
    } as never
    expect(useWorkspaceStore().bookId).toBeFalsy()
    await w.find('[role="tab"][aria-label="Assistant"]').trigger('mousedown')
    await flushPromises()
    expect(w.text()).toContain('Message the assistant')
    expect(w.text()).not.toContain('Set up the story base with the assistant')
  })
})

describe('agentState', () => {
  it('reads the server’s answer, and tells an expired Cloudflare login apart', async () => {
    expect(await agentState(() => json({ state: 'signed-in' }))).toBe('signed-in')
    expect(await agentState(() => json({ state: 'weird' }))).toBe('absent')
    expect(await agentState(() => json({ error: 'Sign in again.' }, 401))).toBe('sign-in-again')
  })

  it('sends the code the person typed to Claude Code’s sign-in exactly as typed, and nothing else', async () => {
    const calls: [string, RequestInit][] = []
    const ok = await sendLoginLine('abc#123 ', async (url, init) => {
      calls.push([String(url), init!])
      return json({ ok: true })
    })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('/agent/login/input')
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ text: 'abc#123 ' })
  })
})

describe('the chat across a reload', () => {
  // The device database outlives a test: start each with no chat kept (the guided start left one).
  beforeEach(() => chatStore.clear(id('wsp', 1)))
  const syncing = {
    enabled: true,
    mode: 'sync',
    folder: 'Aurelia/W (wsp_abcdefghjk)',
    status: 'idle',
    lastBackup: null,
    error: null,
  } as never
  /** The server answers one line of text, or cuts the answer after it when `cut`. */
  async function chatOnce(answer: string, cut = false) {
    const w = await inspectorWith(() => json({ state: 'signed-in' }))
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) !== '/agent/ask') return json({ state: 'signed-in' })
      const lines = [
        { t: 'tool', label: 'Read 1.1 The Gate' },
        { t: 'text', text: answer },
      ]
      if (!cut) lines.push({ t: 'end', ok: true } as never)
      return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(''), {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    })
    useBackupStore().view = syncing
    await w.find('[role="tab"][aria-label="Assistant"]').trigger('mousedown')
    await flushPromises()
    return w
  }
  const other = () => {
    const f = fixture([{ n: 1, title: 'The Gate', body: 'Text.' }], [])
    return { ...f, workspace: { ...f.workspace, id: id('wsp', 2) } }
  }

  it('comes back in the same workspace, only there, and Clear chat removes it from this device', async () => {
    await chatOnce('Tomas is a ferryman.')
    expect(await useAssistant().send('Who is Tomas?')).toBe(true)
    await flushPromises()

    // A reload: a new app, the same device.
    const w = await chatOnce('unused')
    await vi.waitFor(() => expect(w.text()).toContain('Tomas is a ferryman.'))
    expect(w.text()).toContain('Who is Tomas?')
    expect(w.text()).toContain('Read 1.1 The Gate')
    expect(w.text()).not.toContain(STOPPED) // it finished

    // Another workspace opens: not its chat. Switching back mid-load never shows the wrong one.
    const ws = useWorkspaceStore()
    ws.load(other())
    await flushPromises()
    expect(useAssistant().turns.value).toEqual([])
    ws.load(fixture([{ n: 1, title: 'The Gate', body: 'Text.' }], []))
    await nextTick() // its chat is being read...
    ws.load(other()) // ...when another workspace opens
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))
    expect(useAssistant().turns.value).toEqual([])

    ws.load(fixture([{ n: 1, title: 'The Gate', body: 'Text.' }], []))
    ws.select(id('bok', 1), id('scn', 1))
    await vi.waitFor(() => expect(useAssistant().turns.value).toHaveLength(2))
    await flushPromises()
    await w
      .findAll('button')
      .find((b) => b.text() === 'Clear chat')!
      .trigger('click')
    await vi.waitFor(() => expect(w.text()).not.toContain('Tomas is a ferryman.'))
    const after = await chatOnce('unused')
    await new Promise((r) => setTimeout(r, 20))
    expect(after.text()).not.toContain('Who is Tomas?')
  })

  it('tells a screen reader the reply once it is whole, not each piece as it streams in', async () => {
    const w = await chatOnce('unused')
    let finish!: () => void
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) !== '/agent/ask') return json({ state: 'signed-in' })
      const line = (o: object) => new TextEncoder().encode(`${JSON.stringify(o)}\n`)
      const body = new ReadableStream({
        start(c) {
          c.enqueue(line({ t: 'text', text: 'Tomas is' }))
          finish = () => {
            c.enqueue(line({ t: 'text', text: 'a ferryman.' }))
            c.enqueue(line({ t: 'end', ok: true }))
            c.close()
          }
        },
      })
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
    })
    const live = () => w.get('[data-testid="reply-announced"]')
    const sent = useAssistant().send('Who is Tomas?')
    await vi.waitFor(() => expect(w.text()).toContain('Tomas is'))
    expect(live().text()).toBe('')
    expect(w.findAll('[aria-live]')).toHaveLength(1) // the conversation itself is not announced
    finish()
    await sent
    await flushPromises()
    expect(live().text()).toBe('Tomas is\n\na ferryman.')
  })

  it('restores an answer cut off by a reload as what arrived, marked as stopped', async () => {
    await chatOnce('unused')
    // The answer is still arriving when the page goes: the stream never ends here.
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url) !== '/agent/ask') return json({ state: 'signed-in' })
      const body = new ReadableStream({
        start(c) {
          c.enqueue(
            new TextEncoder().encode(`${JSON.stringify({ t: 'text', text: 'Half an answer' })}\n`),
          )
        },
      })
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
    })
    void useAssistant().send('Tell me about the quay.')
    await vi.waitFor(() => expect(useAssistant().turns.value.at(-1)?.text).toBe('Half an answer'))
    await new Promise((r) => setTimeout(r, 20))

    const w = await chatOnce('unused')
    await vi.waitFor(() => expect(w.text()).toContain('Half an answer'))
    expect(w.text()).toContain(STOPPED)
  })

  it('a tab that takes over writing shows, and keeps, the chat the other tab kept meanwhile', async () => {
    const said = (n: number): ChatTurn => ({
      role: n % 2 ? 'assistant' : 'author',
      text: `turn ${n}`,
      tools: [],
    })
    await chatStore.save(id('wsp', 1), [said(1), said(2)])
    await chatOnce('An answer.')
    // Read-only: another tab has the workspace.
    useWorkspaceStore().view = { otherTab: true } as never
    await vi.waitFor(() => expect(useAssistant().turns.value).toHaveLength(2))
    // That tab chats on, then closes: this one takes over.
    await chatStore.save(id('wsp', 1), [1, 2, 3, 4].map(said))
    useWorkspaceStore().view = { otherTab: false } as never
    await vi.waitFor(() => expect(useAssistant().turns.value).toHaveLength(4))
    expect(await useAssistant().send('Next?')).toBe(true)
    await flushPromises()
    await vi.waitFor(async () =>
      expect((await chatStore.load(id('wsp', 1))).map((t) => t.text)).toEqual([
        'turn 1',
        'turn 2',
        'turn 3',
        'turn 4',
        'Next?',
        'An answer.',
      ]),
    )
  })

  it('signing out of Claude Code removes every workspace’s chat on this device', async () => {
    await chatStore.save(id('wsp', 2), [{ role: 'author', text: 'Elsewhere.', tools: [] }])
    await chatOnce('Tomas is a ferryman.')
    expect(await useAssistant().send('Who is Tomas?')).toBe(true)
    await flushPromises()
    await useAssistant().disconnect()
    expect(useAssistant().turns.value).toEqual([])
    expect(await chatStore.load(id('wsp', 1))).toEqual([])
    expect(await chatStore.load(id('wsp', 2))).toEqual([])
  })
})
