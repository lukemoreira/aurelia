// SPDX-License-Identifier: AGPL-3.0-or-later
import { inject, provide, type InjectionKey } from 'vue'

export interface FieldContext {
  id: string
  describedby: string | undefined
  invalid: boolean
}

const KEY: InjectionKey<() => FieldContext> = Symbol('aurelia-field')

/** Field provides its ids; Input, Textarea and Select read them. Reactive via a getter. */
export const provideFieldContext = (get: () => FieldContext) => provide(KEY, get)
export const useFieldContext = (): FieldContext | undefined => inject(KEY, undefined)?.()
