// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import RecordNames from '@/components/world/RecordNames.vue'
import { useReviewStore } from '@/stores/review'
import { useWorkspaceStore } from '@/stores/workspace'
import { fixture, id } from '../../../tests/helpers/index-fixture'
import LinksList from './LinksList.vue'
import NamesTab from './NamesTab.vue'

const RECORDS = [
  { n: 1, title: 'Elena Vasquez', aliases: [{ text: 'Elena' }] },
  { n: 2, title: 'Will Ashby', aliases: [{ text: 'Will' }] },
  { n: 3, title: 'Corin' },
  { n: 4, title: 'Corin', type: 'place' as const },
]

async function setup(
  body: string,
  component: typeof NamesTab | typeof LinksList | typeof RecordNames,
  props = {},
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.load(
    fixture(
      [
        { n: 1, title: 'The Gate', body },
        { n: 2, title: 'Harbour', body: 'Elena waited. See [[Elena Vasquez]].' },
      ],
      RECORDS,
    ),
  )
  ws.select(id('bok', 1), id('scn', 1))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const wrapper = mount(component, { props, global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, ws, router }
}
const text = (w: { text(): string }) => w.text().replace(/\s+/g, ' ')

beforeEach(() => localStorage.clear())

describe('the Names tab', () => {
  const BODY = 'Elena met Corin. Will you stop? Will ran.'

  it('lists the names found with how often, and the questions with who it might be', async () => {
    const { wrapper } = await setup(BODY, NamesTab)
    const t = text(wrapper)
    expect(t).toContain('Found in this scene')
    expect(t).toContain('Elena Vasquez')
    expect(t).toContain('Will Ashby')
    expect(t).toContain('“Corin” · 1 place')
    // Two things share the name: it says which each would be, not "Corin or Corin".
    expect(t).toContain('Corin (character) or Corin (place)?')
    expect(t).toContain('“Will” · 2 places')
    expect(t).toContain('Will Ashby, or the word “will”?')
  })

  it('"Review" asks the editor to take the caret to the first such place', async () => {
    const { wrapper } = await setup(BODY, NamesTab)
    const review = [...wrapper.findAll('button')].find((b) => b.text() === 'Review')!
    await review.trigger('click')
    expect(useReviewStore().name).toBe('Corin')
  })

  it('says so when nothing is named, and when nothing needs an answer', async () => {
    const none = await setup('Nothing here.', NamesTab)
    expect(text(none.wrapper)).toContain('No character or place is named here yet.')
    const quiet = await setup('Elena ran.', NamesTab)
    expect(text(quiet.wrapper)).toContain('Nothing needs your answer.')
  })
})

describe('the links list', () => {
  it('lists what links here, and what is linked, with links that go nowhere said so', async () => {
    const { wrapper } = await setup(
      'See [[Elena Vasquez]] and [[Nobody At All]] and [[Corin]].',
      LinksList,
      {
        id: id('scn', 1),
      },
    )
    const t = text(wrapper)
    expect(t).toContain('Linked from')
    expect(t).toContain('Nothing links here yet.')
    expect(t).toContain('Elena Vasquez1 link')
    expect(t).toContain('Nobody At AllNot found')
    expect(t).toContain('CorinMore than one')
  })

  it('for a record, lists the scenes that link to it or name it', async () => {
    const { wrapper } = await setup('Elena ran.', LinksList, { id: id('chr', 1) })
    expect(text(wrapper)).toContain('The Gate1 mention')
    expect(text(wrapper)).toContain('Harbour1 link · 1 mention')
  })
})

describe('"Found in your writing" on a record', () => {
  it('shows each form and how often, the files, and the questions still open', async () => {
    const { wrapper } = await setup('Elena ran. Elena hid. Corin swam.', RecordNames, {
      id: id('chr', 1),
    })
    const t = text(wrapper)
    expect(t).toContain('“Elena” 3')
    expect(t).toContain('“Elena Vasquez” 1')
    expect(t).toContain('In 2 scenes and notes.')
    const corin = await setup('Corin swam.', RecordNames, { id: id('chr', 3) })
    expect(text(corin.wrapper)).toContain('1 place could be this and Aurelia is asking')
    const none = await setup('Nothing.', RecordNames, { id: id('chr', 2) })
    expect(text(none.wrapper)).toContain('Not named in any scene yet.')
  })
})
