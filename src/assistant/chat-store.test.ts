// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { BackupStore } from '@/backup/state'
import { openDeviceDb } from '@/storage/device-db'
import { CHAT_KEPT, ChatStore, STOPPED, type ChatTurn } from './chat-store'

const A = 'wsp_aaaaaaaaaa'
const B = 'wsp_bbbbbbbbbb'
const turn = (n: number): ChatTurn => ({
  role: n % 2 ? 'assistant' : 'author',
  text: `turn ${n}`,
  tools: [],
})

let db: Promise<IDBDatabase>
let chat: ChatStore
beforeEach(() => {
  db = openDeviceDb(new IDBFactory())
  chat = new ChatStore(() => db)
})

describe('the chat kept on this device', () => {
  it('is restored as it was saved, tool lines and errors included, even from a Vue reactive list', async () => {
    const turns = reactive<ChatTurn[]>([
      { role: 'author', text: 'Who is Tomas?', tools: [] },
      { role: 'assistant', text: 'A ferryman.', tools: ['Read 6.3 The Customs House'] },
      { role: 'assistant', text: '', tools: [], error: 'The assistant did not answer.' },
    ])
    await chat.save(A, turns)
    expect(await chat.load(A)).toEqual(JSON.parse(JSON.stringify(turns)))
  })

  it('is kept per workspace', async () => {
    await chat.save(A, [turn(0)])
    await chat.save(B, [turn(1), turn(2)])
    expect((await chat.load(A)).map((t) => t.text)).toEqual(['turn 0'])
    expect((await chat.load(B)).map((t) => t.text)).toEqual(['turn 1', 'turn 2'])
    expect(await chat.load('wsp_cccccccccc')).toEqual([])
  })

  it(`keeps the last ${CHAT_KEPT} turns, dropping the oldest first`, async () => {
    await chat.save(
      A,
      Array.from({ length: CHAT_KEPT + 7 }, (_, n) => turn(n)),
    )
    const kept = await chat.load(A)
    expect(kept).toHaveLength(CHAT_KEPT)
    expect(kept[0]!.text).toBe('turn 7')
    expect(kept.at(-1)!.text).toBe(`turn ${CHAT_KEPT + 6}`)
  })

  it('restores an answer cut by a reload as what arrived, marked as stopped', async () => {
    await chat.save(A, [
      turn(0),
      { role: 'assistant', text: 'Half of it', tools: ['Read 1.1'], pending: true },
    ])
    expect((await chat.load(A)).at(-1)).toEqual({
      role: 'assistant',
      text: 'Half of it',
      tools: ['Read 1.1'],
      error: STOPPED,
    })
  })

  it('Clear removes only that workspace’s chat, and it can be kept again after', async () => {
    await chat.save(A, [turn(0)])
    await chat.save(B, [turn(1)])
    await chat.clear(A)
    expect(await chat.load(A)).toEqual([])
    expect(await chat.load(B)).toHaveLength(1)
    await chat.save(A, [turn(2)])
    expect(await chat.load(A)).toHaveLength(1)
  })

  it('a deleted workspace’s chat goes, and an answer still arriving does not write it back', async () => {
    await chat.save(A, [turn(0)])
    await chat.forget(A)
    await chat.save(A, [turn(0), turn(1)])
    expect(await chat.load(A)).toEqual([])
  })

  it('shares the backup store without touching its rows', async () => {
    const backup = new BackupStore(() => db)
    const device = await backup.device()
    await chat.save(A, [turn(0)])
    await chat.clear(A)
    expect(await backup.device()).toEqual(device)
  })
})
