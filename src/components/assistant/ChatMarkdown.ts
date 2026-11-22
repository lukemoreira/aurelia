// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant's reply as formatted Markdown. The reply is untrusted (it can quote story text), so
// nothing here is HTML: `marked` only tokenises, and every element below is built by hand. Raw HTML
// shows as text, images never load, and a link is live only for http, https and mailto.
import { Lexer } from 'marked'
import { defineComponent, h, type PropType, type VNodeChild } from 'vue'

interface Tok {
  type: string
  raw: string
  text?: string
  tokens?: Tok[]
  items?: Tok[]
  depth?: number
  ordered?: boolean
  start?: number | ''
  href?: string
  header?: Tok[]
  rows?: Tok[][]
  align?: (string | null)[]
}

const SAFE_LINK = /^(https?:|mailto:)/i
const CELL = 'border border-line px-1.5 py-0.5 text-left align-top'
const ALIGN: Record<string, string> = { center: 'text-center', right: 'text-right' }

function inline(toks: Tok[] | undefined): VNodeChild[] {
  return (toks ?? []).map((t): VNodeChild => {
    const kids = () => inline(t.tokens)
    switch (t.type) {
      case 'strong':
        return h('strong', { class: 'font-semibold' }, kids())
      case 'em':
        return h('em', kids())
      case 'del':
        return h('del', kids())
      case 'codespan':
        return h('code', { class: 'rounded bg-raised px-1 font-mono text-[12px]' }, t.text)
      case 'br':
        return h('br')
      case 'link': {
        const href = (t.href ?? '').trim()
        if (!SAFE_LINK.test(href)) return kids()
        return h(
          'a',
          { href, target: '_blank', rel: 'noopener noreferrer', class: 'text-gold-ink underline' },
          kids(),
        )
      }
      case 'image':
        return t.text || t.raw
      case 'text':
      case 'escape':
        return t.tokens ? kids() : (t.text ?? t.raw)
      default: // html and anything unknown: its text, never markup
        return t.raw
    }
  })
}

function blocks(toks: Tok[] | undefined): VNodeChild[] {
  return (toks ?? []).flatMap((t): VNodeChild[] => {
    switch (t.type) {
      case 'space':
        return []
      case 'paragraph':
        return [h('p', { class: 'm-0' }, inline(t.tokens))]
      case 'text': // a list item's own text
        return [h('p', { class: 'm-0' }, t.tokens ? inline(t.tokens) : (t.text ?? t.raw))]
      case 'heading':
        return [h('p', { class: 'm-0 font-semibold text-ink' }, inline(t.tokens))]
      case 'code':
        return [
          h(
            'pre',
            {
              class:
                'relative m-0 overflow-x-auto rounded bg-raised p-2 font-mono text-[12px] leading-snug',
            },
            h('code', t.text),
          ),
        ]
      case 'blockquote':
        return [
          h(
            'blockquote',
            { class: 'm-0 border-l-2 border-line-2 pl-2 text-ink-2 flex flex-col gap-1.5' },
            blocks(t.tokens),
          ),
        ]
      case 'hr':
        return [h('hr', { class: 'm-0 border-line' })]
      case 'list': {
        const items = (t.items ?? []).map((li) =>
          h('li', { class: 'flex flex-col gap-1' }, blocks(li.tokens)),
        )
        const attrs = {
          class: `m-0 flex flex-col gap-1 pl-5 ${t.ordered ? 'list-decimal' : 'list-disc'}`,
        }
        return [
          t.ordered
            ? h('ol', { ...attrs, start: typeof t.start === 'number' ? t.start : 1 }, items)
            : h('ul', attrs, items),
        ]
      }
      case 'table': {
        const cell = (tag: 'th' | 'td', c: Tok, i: number) =>
          h(
            tag,
            {
              class: `${CELL} ${tag === 'th' ? 'font-semibold' : ''} ${ALIGN[t.align?.[i] ?? ''] ?? ''}`,
            },
            inline(c.tokens),
          )
        return [
          h('div', { class: 'relative overflow-x-auto' }, [
            h('table', { class: 'border-collapse text-[12.5px]' }, [
              h(
                'thead',
                h(
                  'tr',
                  (t.header ?? []).map((c, i) => cell('th', c, i)),
                ),
              ),
              h(
                'tbody',
                (t.rows ?? []).map((r) =>
                  h(
                    'tr',
                    r.map((c, i) => cell('td', c, i)),
                  ),
                ),
              ),
            ]),
          ]),
        ]
      }
      default: // html, definitions and anything unknown: the text as written
        return t.raw.trim() ? [h('p', { class: 'm-0' }, t.raw.trim())] : []
    }
  })
}

export default defineComponent({
  name: 'ChatMarkdown',
  props: { text: { type: String as PropType<string>, required: true } },
  setup(props) {
    return () =>
      h(
        'div',
        { class: 'flex flex-col gap-2 text-[13px] leading-relaxed' },
        blocks(new Lexer({ gfm: true, breaks: true }).lex(props.text) as Tok[]),
      )
  },
})
