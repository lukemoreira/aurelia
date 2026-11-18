// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createWorkspace } from '@/storage/create'
import { MemoryAdapter } from '../../../tests/helpers/memory-adapter.ts'
import { createStoreServer } from '../../store/src/server.ts'

export const FOLDER = 'Aurelia/The Lantern Gate (wsp_abcdefghjk)'

export interface Rig {
  url: string
  root: string
  /** The tokens the store saw, in order. */
  tokens: string[]
  close: () => Promise<void>
}

/** A real aurelia-store over a temp folder, holding one synced workspace; it lets in any token and notes it. */
export async function startStoreWith(edit?: (files: Map<string, string>) => void): Promise<Rig> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aurelia-agent-')))
  const mem = new MemoryAdapter()
  await createWorkspace(mem, 'The Lantern Gate', 'wsp_abcdefghjk')
  const files = new Map<string, string>()
  for (const path of await mem.list()) files.set(path, (await mem.read(path))!.text)
  edit?.(files)
  const listed: Record<string, { hash: string; size: number }> = {}
  for (const [path, text] of files) {
    const at = join(root, FOLDER, 'current', path)
    await mkdir(dirname(at), { recursive: true })
    await writeFile(at, text)
    listed[path] = { hash: 'x', size: Buffer.byteLength(text) }
  }
  await writeFile(
    join(root, FOLDER, 'backup.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'wsp_abcdefghjk',
      deviceId: 'd',
      deviceName: 'Test',
      revision: 1,
      complete: true,
      lastBackup: new Date().toISOString(),
      files: listed,
    }),
  )
  const tokens: string[] = []
  const server: Server = createStoreServer({
    realRoot: root,
    authenticate: async (req: IncomingMessage) => {
      tokens.push(String(req.headers['cf-access-jwt-assertion']))
      return { email: 'x' }
    },
    log: () => undefined,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/dav/`,
    root,
    tokens,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}
