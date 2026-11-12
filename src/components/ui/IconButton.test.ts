// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IconButton from './IconButton.vue'

describe('IconButton', () => {
  it('names the button for screen readers', () => {
    const wrapper = mount(IconButton, { props: { icon: 'plus', label: 'New scene' } })
    expect(wrapper.get('button').attributes('aria-label')).toBe('New scene')
  })

  it('does not compile without a label', () => {
    // @ts-expect-error `label` is required
    const props: InstanceType<typeof IconButton>['$props'] = { icon: 'plus' }
    expect(props.label).toBeUndefined()
  })
})
