// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

/** Run a composable inside a real (empty) component, so lifecycle hooks and watchers have a home. */
export function inComponent<T>(setup: () => T): T {
  let out!: T
  mount(
    defineComponent({
      setup() {
        out = setup()
        return () => null
      },
    }),
  )
  return out
}
