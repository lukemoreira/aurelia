// SPDX-License-Identifier: AGPL-3.0-or-later
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceIndex, type Target } from '@/index/workspace-index'
import { fixture, id } from '../../tests/helpers/index-fixture'
import { editorExtensions } from './extensions'
import type { CardView, LinkEnv, PickerView } from './link-env'
import { createLinks, refreshLinks } from './links'
import { bodyToDoc, docToBody } from './markdown/body'

const RECORDS = [
  { n: 1, title: 'Elena Vasquez', aliases: [{ text: 'Elena' }] },
  { n: 2, title: 'Will Ashby', aliases: [{ text: 'Will' }] },
  { n: 3, title: 'Corin' },
  { n: 4, title: 'Corin', type: 'place' as const },
  { n: 5, title: 'Lantern Quarter', type: 'place' as const, summary: 'Tar and wet rope.' },
]
const scope = { universe: id('unv', 1), book: id('bok', 1) }

let editor: Editor | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function setup(text: string, opts: { writable?: boolean; records?: typeof RECORDS } = {}) {
  const data = fixture([{ n: 1, body: text }], opts.records ?? RECORDS)
  const index = new WorkspaceIndex()
  index.sync(data)
  const log = {
    cards: [] as CardView[],
    closed: 0,
    left: 0,
    pickers: [] as (PickerView | null)[],
    opened: [] as Target[],
    ignored: [] as string[],
  }
  let open = false
  const env: LinkEnv = {
    analyse: (text) => index.analyseText(text, scope),
    pick: (q) => index.pick(q, scope),
    writable: () => opts.writable ?? true,
    target: (i) => index.targetOf(i),
    open: (t) => void log.opened.push(t),
    notAName: (k) => void log.ignored.push(k),
    card: {
      show: (c) => (log.cards.push(c), (open = true), undefined),
      leave: () => void log.left++,
      close: () => {
        log.closed++
        const was = open
        open = false
        return was
      },
      focus: () => open,
    },
    picker: { show: (p) => void log.pickers.push(p), hide: () => void log.pickers.push(null) },
  }
  const holder = document.createElement('div')
  document.body.append(holder)
  const edits: string[] = []
  editor = new Editor({
    element: holder,
    extensions: [...editorExtensions, createLinks(env)],
    content: bodyToDoc(text),
    onUpdate: ({ editor: ed }) => edits.push(docToBody(ed.state.doc)),
  })
  const view = editor.view
  view.hasFocus = () => true // a browser has focus where happy-dom does not
  const q = (sel: string) => [...view.dom.querySelectorAll<HTMLElement>(sel)]
  /** Links as the author reads them: pieces of one link (a small-caps lead-in can split it) joined. */
  const links = () => {
    const out = new Map<string, { text: string; state: string }>()
    for (const e of q('.aur-link')) {
      const k = e.dataset.link!
      out.set(k, { text: (out.get(k)?.text ?? '') + e.textContent, state: e.dataset.state! })
    }
    return [...out.values()].map((l) => [l.text, l.state])
  }
  /** The document position at `needle`'s first character, plus `by`. */
  const posOf = (needle: string, by = 0) => {
    let found = -1
    view.state.doc.descendants((node, pos) => {
      const i = node.isText ? node.text!.indexOf(needle) : -1
      if (found < 0 && i >= 0) found = pos + i
    })
    if (found < 0) throw new Error(`no "${needle}"`)
    return found + by
  }
  const key = (k: string, extra: KeyboardEventInit = {}) =>
    view.someProp('handleKeyDown', (f) =>
      f(view, new KeyboardEvent('keydown', { key: k, ...extra })),
    )
  const type = (text: string) => {
    for (const ch of text) {
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.insertText(ch, from, to))
    }
  }
  const caretAt = (pos: number) => {
    editor!.commands.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  }
  const body = () => docToBody(view.state.doc)
  return { index, log, view, q, links, posOf, key, type, caretAt, body, edits, data }
}

describe('what is drawn over the text', () => {
  const BODY =
    'See [[Elena Vasquez]] and [[Nobody At All]] and [[Corin]].\n\nElena met Corin. Will ran.\n'

  it('draws links by what they point at, names, and questions, and writes nothing', () => {
    const t = setup(BODY)
    expect(t.links()).toEqual([
      ['[[Elena Vasquez]]', 'ok'],
      ['[[Nobody At All]]', 'missing'],
      ['[[Corin]]', 'ambiguous'],
    ])
    expect(t.q('.aur-name').map((e) => [e.textContent, e.dataset.tone])).toEqual([
      ['Elena', 'ember'],
    ])
    expect(t.q('.aur-ask').map((e) => e.textContent)).toEqual(['Corin', 'Will'])
    expect(t.q('.aur-ask-mark')).toHaveLength(2)
    expect(t.body()).toBe(BODY)
    expect(t.edits).toEqual([])
  })

  it('draws an embed as a read-only card after its paragraph, and leaves the text as typed', () => {
    const body = 'Before.\n\n![[Lantern Quarter]]\n\n![[Nowhere]]\n\nAfter.\n'
    const t = setup(body)
    const cards = t.q('.aur-embed')
    expect(cards.map((c) => [c.dataset.state, c.getAttribute('aria-label')])).toEqual([
      ['ok', null], // named by what it shows
      ['missing', 'Embedded card not found: Nowhere'],
    ])
    expect(cards[0]!.textContent).toBe('Place Lantern Quarter Tar and wet rope.')
    expect(cards[0]!.getAttribute('role')).toBe('link')
    expect(cards[0]!.contentEditable).toBe('false')
    expect(t.body()).toBe(body)
  })

  it('does not open an embed card by typing into it, and opens the record when it is clicked', () => {
    const t = setup('![[Lantern Quarter]]\n')
    t.q('.aur-embed')[0]!.click()
    expect(t.log.opened.map((x) => x.title)).toEqual(['Lantern Quarter'])
  })

  it('draws again when a name changes outside the editor', () => {
    const t = setup('Elena ran.\n')
    expect(t.q('.aur-name')).toHaveLength(1)
    t.index.sync({
      ...t.data,
      records: t.data.records.map((r) =>
        r.meta.id === id('chr', 1) ? { ...r, meta: { ...r.meta, aliases: [{ text: 'Lena' }] } } : r,
      ),
    })
    refreshLinks(t.view)
    expect(t.q('.aur-name')).toHaveLength(0)
  })
})

describe('the card on a link or a name', () => {
  it('opens after the pointer rests on a link, with what it points at, and not before', () => {
    const t = setup('See [[Elena Vasquez]].\n')
    t.q('.aur-link')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(200)
    expect(t.log.cards).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(t.log.cards).toHaveLength(1)
    expect(t.log.cards[0]).toMatchObject({
      kind: 'link',
      status: 'ok',
      text: 'Elena Vasquez',
    })
    expect(t.log.cards[0]!.targets.map((x) => x.title)).toEqual(['Elena Vasquez'])
  })

  it('lets the pointer leave, and does not open for a pointer that passed over', () => {
    const t = setup('See [[Elena Vasquez]].\n')
    const link = t.q('.aur-link')[0]!
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    vi.advanceTimersByTime(1000)
    expect(t.log.cards).toHaveLength(0)
    expect(t.log.left).toBe(1)
  })

  it('opens on the keyboard too: the caret in a link, after a pause', () => {
    const t = setup('See [[Elena Vasquez]] now.\n')
    t.caretAt(t.posOf('Elena Vasquez', 3))
    vi.advanceTimersByTime(499)
    expect(t.log.cards).toHaveLength(0)
    vi.advanceTimersByTime(2)
    expect(t.log.cards[0]).toMatchObject({ kind: 'link' })
  })

  it('opens from the caret for a link or a question, never for a name that is plainly known', () => {
    const t = setup('Then Elena ran past it. Corin swam.\n')
    t.caretAt(t.posOf('Elena', 2)) // a tagged name: reading and placing the caret must stay quiet
    vi.advanceTimersByTime(600)
    expect(t.log.cards).toEqual([])
    t.caretAt(t.posOf('Corin', 2)) // a question
    vi.advanceTimersByTime(600)
    expect(t.log.cards.map((c) => [c.kind, c.text])).toEqual([['ask', 'Corin']])
    t.log.cards.length = 0
    t.caretAt(t.posOf('ran', 1))
    vi.advanceTimersByTime(600)
    expect(t.log.cards).toEqual([])
    expect(t.log.left).toBeGreaterThan(0)
  })

  it('is not forgotten when something else updates the editor while it waits', () => {
    const t = setup('See [[Elena Vasquez]] now.\n')
    t.caretAt(t.posOf('Elena Vasquez', 3))
    vi.advanceTimersByTime(200)
    t.view.dispatch(t.view.state.tr.setMeta('somethingElse', true)) // a setting, a decoration…
    vi.advanceTimersByTime(400)
    expect(t.log.cards).toHaveLength(1)
  })

  it('opens from the pointer on a plainly known name too', () => {
    const t = setup('Then Elena ran.\n')
    t.q('.aur-name')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(300)
    expect(t.log.cards.map((c) => [c.kind, c.text])).toEqual([['name', 'Elena']])
  })

  it('stays out of the way of typing: any change to the text closes it and opens none', () => {
    const t = setup('See [[Elena Vasquez]] now.\n')
    t.caretAt(t.posOf('Elena Vasquez', 3))
    t.type('x')
    vi.advanceTimersByTime(1000)
    expect(t.log.cards).toEqual([])
    expect(t.log.closed).toBeGreaterThan(0)
  })

  it('closes on Escape, and Alt+Down moves the keyboard into it', () => {
    const t = setup('See [[Elena Vasquez]].\n')
    expect(t.key('Escape')).toBeFalsy() // nothing open: Escape is left to the rest of the app
    t.q('.aur-link')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(300)
    expect(t.key('ArrowDown', { altKey: true })).toBe(true)
    expect(t.key('Escape')).toBe(true)
    expect(t.key('ArrowDown', { altKey: true })).toBeFalsy()
  })

  it('offers who it might be for a name two records share, and the reason', () => {
    const t = setup('Corin swam.\n')
    t.q('.aur-ask')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(300)
    const card = t.log.cards[0]!
    expect(card).toMatchObject({ kind: 'ask', reason: 'shared', writable: true })
    expect(card.targets.map((x) => x.label)).toEqual(['Character', 'Place'])
  })

  it('offers no answer when the text cannot be changed', () => {
    const t = setup('Corin swam.\n', { writable: false })
    t.q('.aur-ask')[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(300)
    expect(t.log.cards[0]!.writable).toBe(false)
  })
})

describe('opening a link', () => {
  const BODY = 'See [[Elena Vasquez]] and [[Nobody At All]].\n'

  it('opens with Mod-click, and a plain click does nothing but place the caret', () => {
    const t = setup(BODY)
    const pos = t.posOf('Elena Vasquez', 2)
    const click = (init: MouseEventInit) =>
      t.view.someProp('handleClick', (f) => f(t.view, pos, new MouseEvent('click', init)))
    expect(click({})).toBeFalsy()
    expect(click({ metaKey: true })).toBe(true)
    expect(click({ ctrlKey: true })).toBe(true)
    expect(t.log.opened.map((x) => x.id)).toEqual([id('chr', 1), id('chr', 1)])
  })

  it('opens with Mod+Enter in or against a link; a plain Enter is always a new paragraph, even inside one', () => {
    const t = setup(BODY)
    t.caretAt(t.posOf('Elena Vasquez', 4))
    t.key('Enter')
    expect(t.log.opened).toEqual([])
    expect(t.key('Enter', { metaKey: true })).toBe(true)
    expect(t.log.opened).toHaveLength(1)
    t.caretAt(t.posOf('[[Elena Vasquez]]', '[[Elena Vasquez]]'.length))
    expect(t.key('Enter', { ctrlKey: true })).toBe(true)
    expect(t.log.opened).toHaveLength(2)
  })

  it('opens nothing for a link that points nowhere', () => {
    const t = setup(BODY)
    t.caretAt(t.posOf('Nobody At All', 3))
    t.key('Enter', { metaKey: true })
    expect(t.log.opened).toEqual([])
  })
})

describe('answering a question', () => {
  const BODY = 'Corin swam. Corin hid. Will you stop?\n'

  function ask(t: ReturnType<typeof setup>, nth: number) {
    t.q('.aur-ask')[nth]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(300)
    return t.log.cards.at(-1)!
  }

  it('"yes, it is this one" writes a link with the ID at that place, and nowhere else', () => {
    const t = setup(BODY)
    const place = RECORDS[3]!
    const card = ask(t, 1)
    const chosen = card.targets.find((x) => x.id === id('plc', place.n))!
    card.accept(chosen)
    expect(t.body()).toBe('Corin swam. [[id:plc_0000000004|Corin]] hid. Will you stop?\n')
    expect(t.edits).toHaveLength(1)
  })

  it('does not write over text that moved away from where the card was opened', () => {
    const t = setup(BODY)
    const card = ask(t, 0)
    t.view.dispatch(t.view.state.tr.insertText('Oh. ', 1, 1))
    const before = t.body()
    card.accept(card.targets[0]!)
    expect(t.body()).toBe(before)
  })

  it('"not a name" gives the place’s key and writes nothing into the text', () => {
    const t = setup(BODY)
    const card = ask(t, 1)
    card.notAName()
    expect(t.log.ignored).toEqual(['Corin:2'])
    expect(t.body()).toBe(BODY)
  })

  it('a sentence-start name asks once, and the answer names it', () => {
    const t = setup(BODY)
    const card = ask(t, 2)
    expect(card).toMatchObject({ reason: 'sentence-start' })
    card.accept(card.targets[0]!)
    expect(t.body()).toContain('[[id:chr_0000000002|Will]] you stop?')
  })
})

describe('the picker on [[', () => {
  const last = (t: ReturnType<typeof setup>) => t.log.pickers.filter(Boolean).at(-1)!

  it('opens on [[ with some matches, narrows as the name is typed, and closes when it is not a link', () => {
    const t = setup('Start.')
    t.caretAt(t.view.state.doc.content.size - 1)
    t.type(' [[')
    expect(last(t).items.length).toBeGreaterThan(0)
    t.type('lan')
    expect(last(t).items.map((x) => x.title)).toEqual(['Lantern Quarter'])
    expect(last(t).items[0]).toMatchObject({ label: 'Place' })
    t.type(']]')
    expect(t.log.pickers.at(-1)).toBe(null)
  })

  it('Enter writes [[Name]] for the highlighted match, and the arrows move the highlight', () => {
    const t = setup('Start.')
    t.caretAt(t.view.state.doc.content.size - 1)
    t.type(' [[e')
    expect(last(t).active).toBe(0)
    expect(t.key('ArrowDown')).toBe(true)
    expect(last(t).active).toBe(1)
    expect(t.key('ArrowUp')).toBe(true)
    expect(t.key('Enter')).toBe(true)
    expect(t.body()).toBe(`Start. [[${last(t).items[0]!.title}]]`)
    expect(t.view.state.selection.from).toBe(t.view.state.doc.content.size - 1) // the caret is after it
  })

  it('writes the ID, with the name as its label, when two things share the name', () => {
    const t = setup('')
    t.type('[[cor')
    expect(last(t).items.map((x) => [x.title, x.byId])).toEqual([
      ['Corin', true],
      ['Corin', true],
    ])
    t.key('ArrowDown')
    t.key('Enter')
    expect(t.body()).toBe('[[id:plc_0000000004|Corin]]\n')
  })

  it('writes ![[Name]] for an embed, and takes a ]] that is already there', () => {
    const t = setup('')
    t.type('![[]]')
    t.view.dispatch(t.view.state.tr.setSelection(TextSelection.create(t.view.state.doc, 4)))
    t.type('lan')
    t.key('Enter')
    expect(t.body()).toBe('![[Lantern Quarter]]\n')
  })

  it('Escape closes it and leaves what was typed; it stays closed for that [[', () => {
    const t = setup('')
    t.type('[[el')
    expect(t.key('Escape')).toBe(true)
    expect(t.log.pickers.at(-1)).toBe(null)
    t.type('e')
    expect(t.log.pickers.at(-1)).toBe(null)
    expect(t.view.state.doc.textContent).toBe('[[ele')
    t.key('Enter')
    expect(t.view.state.doc.textContent).toBe('[[ele') // nothing is open: Enter is not the picker's
  })

  it('says nothing matches, and Enter then only closes it', () => {
    const t = setup('')
    t.type('[[zzzz')
    expect(last(t).items).toEqual([])
    expect(t.key('Enter')).toBe(true)
    expect(t.view.state.doc.textContent).toBe('[[zzzz')
    expect(t.log.pickers.at(-1)).toBe(null)
  })

  it('points the editor at the list while it is open, and lets go when it closes', () => {
    const t = setup('')
    t.type('[[e')
    expect(t.view.dom.getAttribute('aria-controls')).toBe('link-picker')
    expect(t.view.dom.getAttribute('aria-activedescendant')).toBe('link-option-0')
    t.key('Escape')
    expect(t.view.dom.hasAttribute('aria-controls')).toBe(false)
    expect(t.view.dom.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('does not open in text that cannot be changed', () => {
    const t = setup('', { writable: false })
    t.type('[[e')
    expect(t.log.pickers.filter(Boolean)).toEqual([])
  })
})

describe('a link by ID reads as its label', () => {
  const BODY = 'Then [[id:chr_0000000002|Will]] ran.\n\nAnd [[id:chr_0000000002]] again.\n'

  it('draws the address as nothing, names the link, and writes nothing', () => {
    const t = setup(BODY)
    expect(t.q('.aur-id').map((e) => e.textContent)).toEqual([
      'id:chr_0000000002|',
      'id:chr_0000000002',
    ])
    expect(t.q('.aur-id-title').map((e) => e.textContent)).toEqual(['Will Ashby'])
    expect(t.q('[role="link"]')[0]!.getAttribute('aria-label')).toBe(
      'Link to Will Ashby, character',
    )
    expect(t.body()).toBe(BODY)
    expect(t.edits).toEqual([])
  })

  it('steps over the address as one step, both ways, and with Shift', () => {
    const t = setup(BODY)
    const start = t.posOf('id:chr_0000000002|Will')
    t.caretAt(start)
    expect(t.key('ArrowRight')).toBe(true)
    expect(t.view.state.selection.from).toBe(start + 'id:chr_0000000002|'.length)
    expect(t.key('ArrowLeft')).toBe(true)
    expect(t.view.state.selection.from).toBe(start)
    t.caretAt(start)
    t.key('ArrowRight', { shiftKey: true })
    expect([t.view.state.selection.anchor, t.view.state.selection.head]).toEqual([
      start,
      start + 'id:chr_0000000002|'.length,
    ])
    // Elsewhere an arrow is the browser's own.
    t.caretAt(t.posOf('ran'))
    expect(t.key('ArrowRight')).toBeFalsy()
  })

  it('takes Backspace and Delete at its edge as the same one step, not as a deletion inside it', () => {
    const t = setup(BODY)
    const start = t.posOf('id:chr_0000000002|Will')
    const end = start + 'id:chr_0000000002|'.length
    t.caretAt(end)
    t.key('Backspace')
    expect(t.view.state.selection.from).toBe(start)
    t.key('Delete')
    expect(t.view.state.selection.from).toBe(end)
    expect(t.body()).toBe(BODY)
  })
})

describe('"not a name" keys in the text on screen are the index’s', () => {
  it('number the same places whatever the text is dressed in', () => {
    const text =
      'Corin ran. _Corin_ hid. **Corin** and [[id:plc_0000000004|Corin]] and Corin\\_s too.\n\n- Corin in a list ^blk-abc123\n- Corin again\n'
    const t = setup(text)
    const keys: string[] = []
    for (const [i, el] of t.q('.aur-ask').entries()) {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(300)
      t.log.cards.at(-1)!.notAName()
      void i
    }
    keys.push(...t.log.ignored)
    expect(keys.length).toBeGreaterThan(4)
    expect(keys).toEqual(t.index.ignoreKeys(id('scn', 1), 'Corin'))
  })
})

describe('an embed shows its card and not its line', () => {
  it('hides the line until the caret is in it, and gives the card a keyboard', () => {
    const t = setup('Before.\n\n![[Lantern Quarter]]\n')
    expect(t.q('.aur-embed-hidden')).toHaveLength(1)
    const card = t.q('.aur-embed')[0]!
    expect(card.tabIndex).toBe(0)
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(t.log.opened.map((x) => x.title)).toEqual(['Lantern Quarter'])
    t.caretAt(t.posOf('![[Lantern', 4))
    expect(t.q('.aur-embed-hidden')).toHaveLength(0)
  })
})

describe('Review', () => {
  it('opens the card on the first question of that word, every time it is asked', async () => {
    const { focusName } = await import('./links-plugin')
    const t = setup('Corin swam. Corin hid.\n')
    expect(focusName(t.view, 'Corin')).toBe(true)
    expect(t.log.cards).toHaveLength(1)
    expect(focusName(t.view, 'Corin')).toBe(true) // the caret has not moved: still opens
    expect(t.log.cards).toHaveLength(2)
    expect(focusName(t.view, 'Nobody')).toBe(false)
  })
})

describe('a search result opened at its words', () => {
  it('selects the first place the word is written, with its accent and apostrophe folded', async () => {
    const { focusFound } = await import('./links-plugin')
    const t = setup('The warden’s Élena came.\n\nElena again.\n')
    expect(focusFound(t.view, 'elena')).toBe(true)
    const { from, to } = t.view.state.selection
    expect(t.view.state.doc.textBetween(from, to)).toBe('Élena')
    expect(focusFound(t.view, 'nobody')).toBe(false)
  })
})
