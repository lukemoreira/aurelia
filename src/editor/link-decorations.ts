// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Mention } from '@/index/names'
import type { ResolvedLink } from '@/index/workspace-index'
import { docText } from './doc-text'
import type { LinkEnv } from './link-env'

/*
 * Links and names are drawn over the text, never written into it (ADR-0007, ADR-0010): the
 * decorations come from the same reading of the text that the index makes, so what is on screen
 * and what the Links and Names tabs say are one answer.
 */

export interface Found<T> {
  from: number
  to: number
  value: T
}
export interface LinkState {
  text: string
  links: Found<ResolvedLink>[]
  mentions: Found<Mention>[]
  /** The `id:…|` of a link by ID, which is drawn as nothing: only its label shows. */
  hidden: [from: number, to: number][]
  /** `![[…]]` lines, which show their card only until the caret is in them. */
  embeds: [from: number, to: number][]
  decorations: DecorationSet
}

function el(tag: string, cls: string, text?: string) {
  const node = document.createElement(tag)
  node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/** What a screen reader says of a link. */
const nameOf = (link: ResolvedLink) => {
  const r = link.resolution
  const said = link.label?.trim() || link.target
  if (r.status === 'ok') return `Link to ${r.target.title}, ${r.target.label.toLowerCase()}`
  if (r.status === 'ambiguous') return `Link to “${said}”: more than one thing has this name`
  return `Link to “${said}”: nothing has this name`
}

/** The read-only card an `![[embed]]` is drawn as, after its paragraph. Focusable; Enter opens it. */
function embedCard(link: ResolvedLink, env: LinkEnv): HTMLElement {
  const r = link.resolution
  const target = r.status === 'ok' ? r.target : undefined
  const card = el('div', 'aur-embed')
  card.contentEditable = 'false'
  card.dataset.state = r.status
  if (target) {
    card.setAttribute('role', 'link')
    card.tabIndex = 0
    // Named by what it shows (a name that leaves out the visible words fails the label-in-name rule).
    card.dataset.tone = target.tone
    card.append(
      el('span', 'aur-embed-type', target.label),
      ' ',
      el('strong', 'aur-embed-name', target.title),
    )
    if (target.summary) card.append(' ', el('span', 'aur-embed-summary', target.summary))
    card.addEventListener('click', () => env.open(target))
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      e.stopPropagation()
      env.open(target)
    })
  } else {
    const name = link.label?.trim() || link.target
    card.setAttribute('role', 'group')
    card.setAttribute('aria-label', `Embedded card not found: ${name}`)
    card.append(
      el('strong', 'aur-embed-name', name),
      el(
        'span',
        'aur-embed-summary',
        r.status === 'ambiguous' ? 'More than one thing has this name.' : 'Nothing has this name.',
      ),
    )
  }
  return card
}

/** The links and names in the document, as decorations, and where each is. */
export function buildLinks(doc: Node, env: LinkEnv): LinkState {
  const dt = docText(doc)
  const analysis = env.analyse(dt.text)
  const state: LinkState = {
    text: dt.text,
    links: [],
    mentions: [],
    hidden: [],
    embeds: [],
    decorations: DecorationSet.empty,
  }
  if (!analysis) return state
  const decos: Decoration[] = []
  analysis.links.forEach((link, i) => {
    const [from, to] = dt.range(link.start, link.end)
    state.links.push({ from, to, value: link })
    const r = link.resolution
    decos.push(
      Decoration.inline(from, to, {
        class: link.embed ? 'aur-link aur-embed-src' : 'aur-link',
        'data-link': String(i),
        'data-state': r.status,
        role: 'link',
        'aria-label': nameOf(link),
      }),
    )
    // A link by ID reads as its label: the address is drawn as nothing (and the caret steps over it).
    if (link.id !== undefined && r.status === 'ok') {
      const hideTo = link.labelAt ? link.labelAt[0] : link.targetAt[1]
      const [h0, h1] = dt.range(link.targetAt[0], hideTo)
      if (h1 > h0) {
        state.hidden.push([h0, h1])
        decos.push(Decoration.inline(h0, h1, { class: 'aur-id' }))
        if (!link.labelAt)
          decos.push(
            Decoration.widget(h0, () => el('span', 'aur-id-title', r.target.title), {
              side: -1,
              key: `idt:${link.start}:${r.target.title}`,
            }),
          )
      }
    }
    if (link.embed) {
      state.embeds.push([from, to])
      decos.push(
        Decoration.widget(doc.resolve(to).end(), () => embedCard(link, env), {
          side: 1,
          key: `embed:${link.start}:${link.target}:${r.status}`,
        }),
      )
    }
  })
  analysis.mentions.forEach((m, i) => {
    const [from, to] = dt.range(m.start, m.end)
    state.mentions.push({ from, to, value: m })
    const target = m.status === 'tagged' ? env.target(m.recordIds[0]!) : undefined
    decos.push(
      Decoration.inline(from, to, {
        class: m.status === 'tagged' ? 'aur-name' : 'aur-ask',
        'data-mention': String(i),
        ...(target ? { 'data-tone': target.tone } : {}),
      }),
    )
    if (m.status === 'suggest')
      decos.push(
        Decoration.widget(
          to,
          () => {
            const mark = el('span', 'aur-ask-mark', '?')
            mark.setAttribute('aria-hidden', 'true')
            mark.contentEditable = 'false'
            return mark
          },
          { side: 1, key: `ask:${m.start}:${m.text}` },
        ),
      )
  })
  state.decorations = DecorationSet.create(doc, decos)
  return state
}
