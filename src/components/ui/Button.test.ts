// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Button from './Button.vue'

describe('Button', () => {
  it('keeps gold for the primary action: a quiet button is neutral', () => {
    const quiet = mount(Button, { props: { variant: 'quiet' }, slots: { default: 'Later' } })
    expect(quiet.get('button').classes()).toContain('text-ink-2')
    expect(quiet.get('button').classes()).not.toContain('text-gold-ink')
    const primary = mount(Button, { props: { variant: 'primary' }, slots: { default: 'Save' } })
    expect(primary.get('button').classes()).toContain('bg-gold')
  })
})
