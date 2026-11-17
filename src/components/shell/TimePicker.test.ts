// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import Select from '@/components/ui/Select.vue'
import TimePicker from './TimePicker.vue'

const open = (modelValue: string, props: Record<string, unknown> = {}) =>
  mount(TimePicker, {
    props: {
      modelValue,
      label: 'When',
      'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }),
      ...props,
    },
    attachTo: document.body,
  })
let w: ReturnType<typeof open>
const year = () => w.find<HTMLInputElement>('input[aria-label="Year"]')
/** The era select: the first of the selects (then the month). */
const era = () => w.findAllComponents(Select)[0]!

describe('the year of a story time', () => {
  it('reads a stored BCE key as a year and "before" the epoch', () => {
    w = open('-44-03-15')
    expect(year().element.value).toBe('44')
    expect(era().props('modelValue')).toBe('before')
    expect(era().props('options')).toEqual([
      { value: 'after', label: 'After year 1' },
      { value: 'before', label: 'Before year 1' },
    ])
  })

  it('writes a year typed with the era "before" as a minus sign, with every part after it', async () => {
    w = open('')
    await year().setValue('44')
    expect(w.props('modelValue')).toBe('44')
    // choosing the era (a Reka select: its value is set through the model, as a click would)
    era().vm.$emit('update:modelValue', 'before')
    await nextTick()
    expect(w.props('modelValue')).toBe('-44')
    expect(w.emitted('commit')).toBeTruthy()
  })

  it('takes a minus sign typed before the year as the same thing', async () => {
    w = open('')
    await year().setValue('-44')
    expect(w.props('modelValue')).toBe('-44')
    expect(year().element.value).toBe('44')
    expect(era().props('modelValue')).toBe('before')
    // and the era can still be turned back
    era().vm.$emit('update:modelValue', 'after')
    await nextTick()
    expect(w.props('modelValue')).toBe('44')
  })

  it('writes the era in the calendar’s own words: "before TR" and "TR", or BCE and CE', () => {
    w = open('-5', { era: 'TR' })
    expect(era().props('modelValue')).toBe('before')
    expect(era().props('options')).toEqual([
      { value: 'after', label: 'TR' },
      { value: 'before', label: 'before TR' },
    ])
    w.unmount()
    w = open('5', { era: 'TR' })
    expect(era().props('modelValue')).toBe('after')
  })

  it('names the select for what it does, whatever the calendar calls its eras', () => {
    w = open('5')
    expect(w.find('[aria-label="Before or after"]').exists()).toBe(true)
    expect(w.find('[aria-label="Era"]').exists()).toBe(false)
  })

  it('forgets "before" when the year is cleared: the next year typed is a year after the start', async () => {
    w = open('-44')
    expect(era().props('modelValue')).toBe('before')
    await year().setValue('')
    expect(w.props('modelValue')).toBe('')
    await year().setValue('412')
    expect(w.props('modelValue')).toBe('412')
    expect(era().props('modelValue')).toBe('after')
  })

  it('does not write a minus zero: "before" means nothing for year 0', async () => {
    w = open('')
    era().vm.$emit('update:modelValue', 'before')
    await year().setValue('0')
    expect(w.props('modelValue')).toBe('0')
    await year().setValue('00')
    expect(w.props('modelValue')).toBe('00')
    expect(w.props('modelValue')).not.toMatch(/^-/)
  })

  it('leaves a time after the epoch exactly as it was', async () => {
    w = open('412-03-14T18:00')
    expect(year().element.value).toBe('412')
    expect(w.props('modelValue')).toBe('412-03-14T18:00')
  })
})
