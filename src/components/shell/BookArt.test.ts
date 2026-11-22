// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { sampleId } from '@/sample/ids'
import { useWorkspaceStore } from '@/stores/workspace'
import { exportFixture, unv } from '../../../tests/helpers/export-fixture'
import BookArt from './BookArt.vue'

const MED = sampleId('med', 'art')
const stubs = { MediaImage: { template: '<i data-test="image" />' }, MediaGallery: true }

function setup(kind: 'logo' | 'cover', gallery: boolean, props = {}) {
  setActivePinia(createPinia())
  const data = exportFixture()
  data.media = gallery
    ? [{ meta: { schemaVersion: 1, id: MED, file: `${MED}.png` }, universe: unv }]
    : []
  useWorkspaceStore().load(data)
  return mount(BookArt, {
    props: { kind, title: 'The Lantern Gate', image: MED, editable: true, ...props },
    global: { stubs },
    attachTo: document.body,
  })
}

describe('a book’s logo and cover art', () => {
  beforeEach(() => void (document.body.innerHTML = ''))

  it('shows the chosen image, a tall frame for the cover and a small one for the logo', () => {
    const cover = setup('cover', true)
    expect(cover.find('[data-test=image]').exists()).toBe(true)
    expect(cover.get('button[aria-label="Change cover art"]').classes()).toContain('h-[132px]')
    expect(setup('logo', true).get('button[aria-label="Change logo"]').classes()).toContain(
      'size-16',
    )
  })

  it('takes the choice away with Remove, and says so to the book', async () => {
    const w = setup('logo', true)
    await w.get('button:not([aria-label])').trigger('click')
    expect(w.emitted('clear')).toHaveLength(1)
  })

  it('reads an image that was deleted as none: the initials, an Add button and nothing to remove', () => {
    const w = setup('cover', false)
    expect(w.find('[data-test=image]').exists()).toBe(false)
    expect(w.find('button[aria-label="Add cover art"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Remove')
  })

  it('is only a picture when the book is read only', () => {
    const w = setup('cover', true, { editable: false })
    expect(w.find('button').exists()).toBe(false)
  })
})
