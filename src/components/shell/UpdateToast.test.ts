// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startUpdates, useAppUpdate } from '@/composables/useAppUpdate'
import UpdateToast from './UpdateToast.vue'

const apply = vi.fn(() => Promise.resolve())
let needRefresh: () => void

beforeEach(() => {
  apply.mockClear()
  startUpdates(((o: { onNeedRefresh?: () => void }) => {
    needRefresh = () => o.onNeedRefresh?.()
    return apply
  }) as unknown as Parameters<typeof startUpdates>[0])
  useAppUpdate().dismiss()
})

describe('UpdateToast', () => {
  it('is not there until a new version is waiting', () => {
    expect(mount(UpdateToast).find('[role="status"]').exists()).toBe(false)
  })

  it('offers Reload and Later, and reloads only on Reload', async () => {
    const wrapper = mount(UpdateToast)
    needRefresh()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('Update available')
    expect(apply).not.toHaveBeenCalled()
    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['Reload', 'Later'])
    await buttons[1]!.trigger('click')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(apply).not.toHaveBeenCalled()

    needRefresh()
    await wrapper.vm.$nextTick()
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(apply).toHaveBeenCalledWith(true)
  })

  it('asks for a sign-in when the session ended, and goes to /signin on Sign in', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const wrapper = mount(UpdateToast)
    useAppUpdate().signInNeeded.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('Sign in again to get updates')
    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['Sign in', 'Later'])
    await buttons[0]!.trigger('click')
    expect(assign).toHaveBeenCalledWith('/signin')
    await buttons[1]!.trigger('click')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    assign.mockRestore()
  })
})
