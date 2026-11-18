// SPDX-License-Identifier: AGPL-3.0-or-later
// The MCP server as Claude Code starts it: plain `node`, the app's own src/ layers loaded unchanged through
// the resolve hook (ADR-0008: the plain-TS layers run in Node; this is the CI test that says so).
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, expect, it } from 'vitest'
import { ALLOWED_TOOLS } from '../src/tools.ts'
import { FOLDER, startStoreWith, type Rig } from './helpers.ts'

let rig: Rig | null = null
afterEach(async () => {
  await rig?.close()
  rig = null
})

it('serves exactly Aurelia’s tools over stdio in plain Node, reading the store as the person', async () => {
  rig = await startStoreWith()
  const src = (f: string) => fileURLToPath(new URL(`../src/${f}`, import.meta.url))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', src('register.ts'), src('mcp.ts')],
    env: {
      PATH: process.env.PATH ?? '',
      AURELIA_STORE_URL: rig.url,
      AURELIA_FOLDER: FOLDER,
      AURELIA_ACCESS_JWT: 'token-of-bob',
    },
    stderr: 'ignore',
  })
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    expect(tools.map((t) => `mcp__aurelia__${t.name}`).sort()).toEqual([...ALLOWED_TOOLS].sort())
    const outline = await client.callTool({ name: 'get_outline', arguments: {} })
    const [label, data] = outline.content as { text: string }[]
    expect(label!.text).toBe('Read the outline of “The Lantern Gate”')
    expect(data!.text).toMatch(/Chapter 1 chp_/)
    expect(new Set(rig.tokens)).toEqual(new Set(['token-of-bob']))
  } finally {
    await client.close()
  }
}, 30_000)

it('a workspace read that failed once is tried again at the next tool call', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { createMcpServer, storeAs } = await import('../src/mcp.ts')
  const { readWorkspace } = await import('../src/workspace.ts')
  rig = await startStoreWith()
  const store = storeAs(rig.url, 't')
  let tries = 0
  const server = createMcpServer(async () => {
    if (++tries === 1) throw new Error('The store did not answer.')
    return { store, folder: FOLDER, ws: () => readWorkspace(store, FOLDER) }
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(b)
  const first = await client.callTool({ name: 'get_outline', arguments: {} })
  expect(first.isError).toBe(true)
  const second = await client.callTool({ name: 'get_outline', arguments: {} })
  expect(second.isError).toBeFalsy()
  expect((second.content as { text: string }[])[0]!.text).toBe(
    'Read the outline of “The Lantern Gate”',
  )
  await client.close()
})
