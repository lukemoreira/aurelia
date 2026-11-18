// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import Inspector from '@/components/shell/Inspector.vue'
import { agentState, sendLoginLine } from '@/assistant/client'
import { GUIDED_START } from '@/composables/useAssistant'
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
