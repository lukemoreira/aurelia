// SPDX-License-Identifier: AGPL-3.0-or-later
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, type EditorView } from '@tiptap/pm/view'
import { linkText } from '@/index/links'
import { ignoreKey } from '@/index/names'
import { findFolded } from '@/index/search'
import type { Target } from '@/index/workspace-index'
import { docText } from './doc-text'
import { buildLinks, type LinkState } from './link-decorations'
import type { LinkEnv } from './link-env'

const linksKey = new PluginKey<LinkState>('aurelia-links')

/** Read the text again: a name, an answer or a title changed outside the editor. */
export const refreshLinks = (view: EditorView) =>
  view.dispatch(view.state.tr.setMeta(linksKey, 'refresh').setMeta('addToHistory', false))

const HOVER_MS = 250
const CARET_MS = 500

type Hit = { link?: number; mention?: number }

/** What the caret is on, for a card: strictly inside a link, or in a name Aurelia is asking about. */
function caretHit(state: LinkState, pos: number): Hit | null {
  const link = state.links.findIndex((l) => l.from < pos && pos < l.to)
  if (link >= 0) return { link }
  const mention = state.mentions.findIndex(
    (m) => m.value.status === 'suggest' && m.from <= pos && pos <= m.to,
  )
  return mention >= 0 ? { mention } : null
}

/** Where a card for a link or a name can be opened again from (the Names tab's "Review"). */
const showers = new WeakMap<EditorView, (hit: Hit) => void>()

/** Open the card on the first name the app is asking about, with the caret on it; false when none reads `text`. */
export function focusName(view: EditorView, text: string): boolean {
  const st = linksKey.getState(view.state)
  const i =
    st?.mentions.findIndex((m) => m.value.status === 'suggest' && m.value.text === text) ?? -1
  if (!st || i < 0) return false
  view.focus()
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, st.mentions[i]!.to))
      .scrollIntoView(),
  )
  // Asked for twice, the card is there twice: it does not wait for the caret to move.
  showers.get(view)?.({ mention: i })
  return true
}

/** Select the first place `term` is written (a search result opened at its match); false when it is not found. */
export function focusFound(view: EditorView, term: string): boolean {
  const dt = docText(view.state.doc)
  const at = findFolded(dt.text, term)
  if (!at) return false
  const [from, to] = dt.range(at[0], at[1])
  view.focus()
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView(),
  )
  return true
}

export function linksPlugin(env: LinkEnv): Plugin<LinkState> {
  let hover: HTMLElement | null = null
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let caretTimer: ReturnType<typeof setTimeout> | undefined

  function show(view: EditorView, hit: Hit) {
    const st = linksKey.getState(view.state)
    if (!st) return
    const node = view.dom.querySelector<HTMLElement>(
      hit.link !== undefined ? `[data-link="${hit.link}"]` : `[data-mention="${hit.mention}"]`,
    )
    if (!node) return
    const base = {
      rect: node.getBoundingClientRect(),
      writable: env.writable() && view.editable,
      open: env.open,
      pick: env.pick,
      returnFocus: () => view.focus(),
    }
    if (hit.link !== undefined) {
      const link = st.links[hit.link]!.value
      const r = link.resolution
      env.card.show({
        ...base,
        kind: 'link',
        text: link.label?.trim() || link.target,
        targets: r.status === 'ok' ? [r.target] : r.status === 'ambiguous' ? r.targets : [],
        status: r.status,
        accept: () => undefined,
        notAName: () => undefined,
      })
      return
    }
    const { from, to, value: m } = st.mentions[hit.mention!]!
    const targets = m.recordIds.flatMap((id) => env.target(id) ?? [])
    const key = ignoreKey(st.text, m)
    env.card.show({
      ...base,
      kind: m.status === 'tagged' ? 'name' : 'ask',
      text: m.text,
      targets,
      status: targets.length === 1 ? 'ok' : 'ambiguous',
      ...(m.reason ? { reason: m.reason } : {}),
      accept: (t: Target) => {
        // The card closes when the text changes, so the place is where it was; check anyway.
        if (view.state.doc.textBetween(from, to) !== m.text) return
        view.dispatch(view.state.tr.insertText(linkText(m.text, { id: t.id }), from, to))
        env.card.close()
        view.focus()
      },
      notAName: () => env.notAName(key),
    })
  }

  /** The caret steps over an address it cannot see: the `id:…|` of a link is one step, not twenty. */
  function stepOverHidden(view: EditorView, event: KeyboardEvent): boolean {
    const st = linksKey.getState(view.state)
    if (!st?.hidden.length || event.altKey || event.metaKey || event.ctrlKey) return false
    const { selection } = view.state
    const head = selection.head
    const dir =
      event.key === 'ArrowRight' || event.key === 'Delete'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'Backspace'
          ? -1
          : 0
    if (!dir) return false
    // A key that leaves the selection to the browser (a range, Delete or Backspace with one) is not ours.
    if (!selection.empty && !(event.shiftKey && event.key.startsWith('Arrow'))) return false
    const range = st.hidden.find(([a, b]) =>
      dir > 0 ? a <= head && head < b : a < head && head <= b,
    )
    if (!range) return false
    const to = dir > 0 ? range[1] : range[0]
    const next =
      event.shiftKey && event.key.startsWith('Arrow')
        ? TextSelection.create(view.state.doc, selection.anchor, to)
        : TextSelection.create(view.state.doc, to)
    view.dispatch(view.state.tr.setSelection(next).scrollIntoView())
    return true
  }

  return new Plugin<LinkState>({
    key: linksKey,
    state: {
      init: (_, state) => buildLinks(state.doc, env),
      apply: (tr, prev, _old, state) =>
        tr.docChanged || tr.getMeta(linksKey) === 'refresh' ? buildLinks(state.doc, env) : prev,
    },
    props: {
      decorations(state) {
        const st = linksKey.getState(state)
        if (!st) return undefined
        // An embed shows its card, not its line, until the caret comes into the line.
        const { from, to } = state.selection
        const hide = st.embeds
          .filter(([a, b]) => !(a <= from && to <= b))
          .map(([a, b]) => Decoration.inline(a, b, { class: 'aur-embed-hidden' }))
        return hide.length ? st.decorations.add(state.doc, hide) : st.decorations
      },
      handleClick(view, pos, event) {
        if (!(event.metaKey || event.ctrlKey)) return false
        const st = linksKey.getState(view.state)!
        const link = st.links.find((l) => l.from < pos && pos < l.to)
        const r = link?.value.resolution
        if (r?.status !== 'ok') return false
        env.open(r.target)
        return true
      },
      handleKeyDown(view, event) {
        if (event.key === 'Escape') return env.card.close()
        if (event.altKey && event.key === 'ArrowDown') return env.card.focus()
        if (stepOverHidden(view, event)) return true
        // Mod+Enter opens the link the caret is in or against; a plain Enter is always a new paragraph.
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.shiftKey)
          return false
        const st = linksKey.getState(view.state)!
        const { from, empty } = view.state.selection
        const link = empty ? st.links.find((l) => l.from <= from && from <= l.to) : undefined
        const r = link?.value.resolution
        if (r?.status !== 'ok') return false
        env.open(r.target)
        return true
      },
      handleDOMEvents: {
        mouseover(view, event) {
          const node = (event.target as HTMLElement).closest?.<HTMLElement>(
            '[data-link],[data-mention]',
          )
          if (!node || node === hover) return false
          hover = node
          clearTimeout(hoverTimer)
          hoverTimer = setTimeout(() => {
            if (!node.isConnected) return
            show(
              view,
              node.dataset.link !== undefined
                ? { link: Number(node.dataset.link) }
                : { mention: Number(node.dataset.mention) },
            )
          }, HOVER_MS)
          return false
        },
        mouseout(_view, event) {
          const next = (event.relatedTarget as HTMLElement | null)?.closest?.(
            '[data-link],[data-mention]',
          )
          if (next && next === hover) return false
          clearTimeout(hoverTimer)
          hover = null
          env.card.leave()
          return false
        },
      },
    },
    view: (editorView) => {
      showers.set(editorView, (hit) => show(editorView, hit))
      return {
        update(view, prev) {
          if (view.state.doc !== prev.doc) {
            clearTimeout(caretTimer)
            return void env.card.close() // typing is writing: no card
          }
          // Anything else that updates the view (a setting, a decoration) leaves a pending card alone.
          if (view.state.selection.eq(prev.selection)) return
          clearTimeout(caretTimer)
          const { empty, from } = view.state.selection
          const hit =
            empty && view.hasFocus() ? caretHit(linksKey.getState(view.state)!, from) : null
          if (!hit) return void env.card.leave()
          caretTimer = setTimeout(() => show(view, hit), CARET_MS)
        },
        destroy: () => {
          clearTimeout(hoverTimer)
          clearTimeout(caretTimer)
          env.card.close()
        },
      }
    },
  })
}
