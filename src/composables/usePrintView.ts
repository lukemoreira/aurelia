// SPDX-License-Identifier: AGPL-3.0-or-later
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PRINT_CLASS } from '@/export/print-class'
import { useLayoutStore } from '@/stores/layout'

/**
 * The print view of a PDF export: while a book is laid out (`layout.print`), its stylesheet is in the page,
 * the rest of the app is out of reach (`inert`), the tab is named after the book (so "Save as PDF" suggests
 * that name), and Escape closes it. Print is the browser's own: `window.print()`.
 */
export function usePrintView() {
  const layout = useLayoutStore()
  /** The Print button (a component): its element takes the focus. */
  const printButton = ref<{ $el: HTMLElement } | null>(null)
  let style: HTMLStyleElement | undefined
  let title = ''
  let opener: Element | null = null

  const app = () => document.getElementById('app')
  function close() {
    layout.print = null
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()

  function release() {
    style?.remove()
    style = undefined
    document.documentElement.classList.remove(PRINT_CLASS)
    app()?.removeAttribute('inert')
    document.removeEventListener('keydown', onKey)
    if (title) document.title = title
    title = ''
    if (opener instanceof HTMLElement) opener.focus()
    opener = null
  }

  watch(
    () => layout.print,
    async (view) => {
      if (!view) return release()
      opener = layout.printReturn ?? document.activeElement
      layout.printReturn = null
      title = document.title
      document.title = view.title
      style = Object.assign(document.createElement('style'), { textContent: view.css })
      document.head.append(style)
      document.documentElement.classList.add(PRINT_CLASS)
      app()?.setAttribute('inert', '')
      document.addEventListener('keydown', onKey)
      await nextTick()
      printButton.value?.$el.focus()
    },
    { flush: 'post' },
  )
  onBeforeUnmount(release)

  return {
    /** For the Print button's `:ref`. */
    bindPrint: (el: unknown) => (printButton.value = el as { $el: HTMLElement } | null),
    close,
    print: () => window.print(),
  }
}
