// SPDX-License-Identifier: AGPL-3.0-or-later
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { linkText } from '@/index/links'
import type { LinkEnv, PickItem } from './link-env'

/** `[[` typed, and what has been typed since: where it started, the caret, the words, the matches. */
interface Picking {
  from: number
  to: number
  query: string
  items: PickItem[]
  active: number
  dismissed: boolean
}

const key = new PluginKey<Picking | null>('aurelia-link-picker')
/** The listbox the matches are drawn in: the editor points at it while it is open. */
export const PICKER_ID = 'link-picker'
export const optionId = (i: number) => `link-option-${i}`

/** `[[` before the caret in the same paragraph, with nothing closed since. */
function typed(view: {
  doc: import('@tiptap/pm/model').Node
  selection: import('@tiptap/pm/state').Selection
}) {
  const { $from, empty } = view.selection
  if (!empty || !$from.parent.isTextblock) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const m = /\[\[([^[\]\n|]*)$/.exec(before)
  return m ? { from: $from.pos - m[1]!.length - 2, to: $from.pos, query: m[1]! } : null
}

/** Turn the `[[…` being typed into a link to `item` (taking a `]]` that is already there). */
export function chooseLink(view: EditorView, item: PickItem) {
  const st = key.getState(view.state)
  if (!st) return
  const { doc } = view.state
  const closed = doc.textBetween(st.to, Math.min(st.to + 2, doc.content.size), '\n', '￼') === ']]'
  view.dispatch(
    view.state.tr.insertText(
      linkText(item.title, item.byId ? { id: item.id } : {}),
      st.from,
      st.to + (closed ? 2 : 0),
    ),
  )
  view.focus()
}

export function linkPickerPlugin(env: LinkEnv): Plugin<Picking | null> {
  return new Plugin<Picking | null>({
    key,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const found = typed(state)
        if (!found || !env.writable()) return null
        const same = prev?.from === found.from
        const move = (tr.getMeta(key) as { by?: number; dismiss?: boolean } | undefined) ?? {}
        const items =
          prev && same && prev.query === found.query ? prev.items : env.pick(found.query)
        const active = same && prev!.query === found.query ? prev!.active : 0
        return {
          ...found,
          items,
          active: items.length ? (active + (move.by ?? 0) + items.length) % items.length : 0,
          dismissed: same && (prev!.dismissed || !!move.dismiss),
        }
      },
    },
    props: {
      handleKeyDown(view, event) {
        const st = key.getState(view.state)
        if (!st || st.dismissed) return false
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          view.dispatch(view.state.tr.setMeta(key, { by: event.key === 'ArrowDown' ? 1 : -1 }))
          return true
        }
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(key, { dismiss: true }))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = st.items[st.active]
          if (item) chooseLink(view, item)
          else view.dispatch(view.state.tr.setMeta(key, { dismiss: true }))
          return true
        }
        return false
      },
    },
    view: () => ({
      update(view) {
        const st = key.getState(view.state)
        if (!st || st.dismissed) {
          env.picker.hide()
          view.dom.removeAttribute('aria-controls')
          view.dom.removeAttribute('aria-activedescendant')
          return
        }
        env.picker.show({
          rect: () => {
            const c = view.coordsAtPos(key.getState(view.state)?.to ?? st.to)
            return new DOMRect(c.left, c.top, 0, c.bottom - c.top)
          },
          query: st.query,
          items: st.items,
          active: st.active,
          choose: (item) => chooseLink(view, item),
        })
        view.dom.setAttribute('aria-controls', PICKER_ID)
        if (st.items.length) view.dom.setAttribute('aria-activedescendant', optionId(st.active))
        else view.dom.removeAttribute('aria-activedescendant')
      },
      destroy: () => env.picker.hide(),
    }),
  })
}
