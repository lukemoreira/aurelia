// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../tests/helpers/outline-rig'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => router }))

import { useImportDialog } from './useImportDialog'

const file = (name: string, text: string, folder?: string) =>
  Object.assign(new File([text], name), folder ? { webkitRelativePath: `${folder}/${name}` } : {})

beforeEach(() => {
  setActivePinia(createPinia())
  router.push.mockReset()
})

async function rig() {
  const r = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(r.session)
  ws.bookId = r.session.data.books[0]!.id
  return { r, ws }
}

describe('the Import dialog', () => {
  it('reads what was picked into a preview, and writes nothing until the author says so', async () => {
    const { r } = await rig()
    const before = (await r.adapter.list()).length
    const open = ref(true)
    const x = useImportDialog(open, () => ({ kind: 'workspace' }))
    await x.pick([
      file('a.md', '# One\n\nWords.', 'Novel'),
      file('b.md', 'More words.', 'Novel'),
      file('cover.png', 'x', 'Novel'),
    ])
    expect(x.step.value).toBe('preview')
    expect(x.title.value).toBe('Novel')
    expect(x.stats.value).toMatchObject({ chapters: 1, scenes: 2 })
    expect(x.plan.value!.report.unread.map((i) => i.names)).toEqual([['cover.png']])
    expect((await r.adapter.list()).length).toBe(before)
  })

  it('says why in plain words when nothing could be read, and stays on the first step', async () => {
    await rig()
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    await x.pick([file('cover.png', 'x')])
    expect(x.step.value).toBe('pick')
    expect(x.error.value).toMatch(/found no writing/)
  })

  it('makes the book under the name in the box, opens its first scene and closes', async () => {
    const { r, ws } = await rig()
    const open = ref(true)
    const x = useImportDialog(open, () => ({ kind: 'workspace' }))
    await x.pick([file('a.md', '# One\n\nWords.')])
    x.title.value = 'My import'
    await x.make()
    expect(open.value).toBe(false)
    const book = ws.data!.books.find((b) => b.title === 'My import')!
    expect(book).toBeTruthy()
    const scene = ws.data!.scenes.find((s) => s.book === book.id)!
    expect(router.push).toHaveBeenCalledWith(`/w/${book.id}/${scene.meta.id}`)
    expect(r.session.data.books).toHaveLength(2)
  })

  it('says what was made, and how many files were left out, when the book is in', async () => {
    await rig()
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    await x.pick([file('a.md', 'Words.', 'N'), file('x.png', 'x', 'N'), file('y.png', 'x', 'N')])
    x.title.value = 'My import'
    await x.make()
    expect(useEditsStore().toast?.text).toBe(
      'Imported “My import”: 1 chapter, 1 scene. 2 files were not read.',
    )
  })

  it('says only where the book goes when that is a shared universe', async () => {
    const { r, ws } = await rig()
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    expect(x.where.value).toBe('')
    await r.session.setFields(ws.universe!.id, { kind: 'shared' })
    expect(x.where.value).toMatch(/^ in /)
  })

  it('a book made while a shared universe is open is a book of that universe', async () => {
    const { r, ws } = await rig()
    await r.session.setFields(ws.universe!.id, { kind: 'shared' })
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    expect(x.where.value).toMatch(/^ in /)
    await x.pick([file('a.md', 'Words.')])
    await x.make()
    expect(ws.data!.universes).toHaveLength(1)
    expect(ws.data!.universes[0]!.books).toHaveLength(2)
  })

  it('on the Welcome screen it hands the plan and the name to what makes the workspace, and shows a failure', async () => {
    const make = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const open = ref(true)
    const x = useImportDialog(open, () => ({ kind: 'new', make }))
    await x.pick([file('a.md', 'Words.')])
    x.title.value = 'Fresh'
    await x.make()
    expect(make).toHaveBeenCalledWith(expect.objectContaining({ source: 'markdown' }), 'Fresh')
    expect(x.step.value).toBe('preview')
    expect(x.error.value).toMatch(/Nothing you had was changed/)
    expect(open.value).toBe(true)
    await x.make()
    expect(open.value).toBe(false)
  })

  it('will not make a book with no name, or a workspace with too long a name', async () => {
    const { r } = await rig()
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    await x.pick([file('a.md', 'Words.')])
    x.title.value = '  '
    expect(x.nameCheck.value.ok).toBe(false)
    await x.make()
    expect(r.session.data.books).toHaveLength(1)
    const make = vi.fn()
    const w = useImportDialog(ref(true), () => ({ kind: 'new', make }))
    await w.pick([file('a.md', 'Words.')])
    w.title.value = 'x'.repeat(81)
    expect(w.nameCheck.value.error).toMatch(/under 80/)
    await w.make()
    expect(make).not.toHaveBeenCalled()
  })

  it('starts over from the first step', async () => {
    const x = useImportDialog(ref(true), () => ({ kind: 'workspace' }))
    await x.pick([file('a.md', 'Words.')])
    x.back()
    expect(x.step.value).toBe('pick')
    expect(x.plan.value).toBeNull()
  })
})
