// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import Inspector from '@/components/shell/Inspector.vue'
import { agentState } from '@/assistant/client'
import { useWorkspaceStore } from '@/stores/workspace'
import { fixture, id } from '../../../tests/helpers/index-fixture'

async function inspectorWith(answer: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(answer))
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.load(fixture([{ n: 1, title: 'The Gate', body: 'Text.' }], []))
  ws.select(id('bok', 1), id('scn', 1))
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

  it('is there when the server runs one, and asks a signed-out person to connect their own Claude account', async () => {
    const w = await inspectorWith(() => json({ state: 'signed-out' }))
    expect(tabs(w)).toContain('Assistant')
    await w.find('[role="tab"][aria-label="Assistant"]').trigger('mousedown')
    await flushPromises()
    expect(w.text()).toContain('Connect your Claude account')
    expect(w.text()).toContain('Sign in with Claude')
  })
})

describe('agentState', () => {
  it('reads the server’s answer, and tells an expired Cloudflare login apart', async () => {
    expect(await agentState(() => json({ state: 'signed-in' }))).toBe('signed-in')
    expect(await agentState(() => json({ state: 'weird' }))).toBe('absent')
    expect(await agentState(() => json({ error: 'Sign in again.' }, 401))).toBe('sign-in-again')
  })
})
