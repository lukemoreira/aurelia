// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SeverityTag, { type Severity } from './SeverityTag.vue'

describe('SeverityTag', () => {
  it.each<[Severity, string]>([
    ['error', 'Error'],
    ['warning', 'Warning'],
    ['note', 'Note'],
  ])('always shows the word for %s', (severity, word) => {
    expect(mount(SeverityTag, { props: { severity } }).text()).toBe(word)
  })
})
