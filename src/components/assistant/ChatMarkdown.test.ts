// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatMarkdown from './ChatMarkdown'

const render = (text: string) => mount(ChatMarkdown, { props: { text } })

describe('ChatMarkdown', () => {
  it('shows a plain sentence as one paragraph', () => {
    const w = render('Tomas is a ferryman.')
    expect(w.findAll('p')).toHaveLength(1)
    expect(w.text()).toBe('Tomas is a ferryman.')
  })

  it('renders inline formatting', () => {
    const w = render('**b** *i* ~~s~~ `c`')
    expect(w.find('strong').text()).toBe('b')
    expect(w.find('em').text()).toBe('i')
    expect(w.find('del').text()).toBe('s')
    expect(w.find('code').text()).toBe('c')
  })

  it('renders blocks', () => {
    const w = render(
      '### Title\n\n- a\n  - nested\n\n1. x\n2. y\n\n> quote\n\n---\n\n```\ncode\n```\n\n| h1 | h2 |\n|---|---|\n| 1 | 2 |',
    )
    expect(w.find('ul ul li').text()).toBe('nested')
    expect(w.find('ol').findAll('li')).toHaveLength(2)
    expect(w.find('blockquote').text()).toBe('quote')
    expect(w.find('hr').exists()).toBe(true)
    expect(w.find('pre code').text()).toBe('code')
    expect(w.findAll('th').map((c) => c.text())).toEqual(['h1', 'h2'])
    expect(w.findAll('td').map((c) => c.text())).toEqual(['1', '2'])
    expect(w.text()).toContain('Title')
    expect(w.text()).not.toContain('###')
  })

  it('keeps single line breaks', () => {
    expect(render('a\nb').findAll('br')).toHaveLength(1)
  })

  it('opens http, https and mailto links safely', () => {
    for (const url of ['https://x.org', 'http://x.org', 'mailto:a@b.c']) {
      const a = render(`[go](${url})`).find('a')
      expect(a.attributes('href')).toBe(url)
      expect(a.attributes('target')).toBe('_blank')
      expect(a.attributes('rel')).toBe('noopener noreferrer')
    }
  })

  it('shows other links as text', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'JaVaScRiPt:1']) {
      const w = render(`[go](${url})`)
      expect(w.find('a').exists()).toBe(false)
      expect(w.text()).toBe('go')
    }
  })

  it('never loads images or raw HTML', () => {
    const w = render(
      '![the alt](http://x/y.png)\n\n<img src=x onerror=1> and <script>boom()</script>\n\n<div>block</div>',
    )
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('script').exists()).toBe(false)
    expect(w.findAll('div')).toHaveLength(1)
    expect(w.text()).toContain('the alt')
    expect(w.text()).toContain('<img src=x onerror=1>')
    expect(w.text()).toContain('<div>block</div>')
  })

  it('does not throw on half-finished markdown', () => {
    for (const s of [
      '**half',
      '*a **b',
      '`code',
      '[link](http://x',
      '```\nopen',
      '| a |\n|--',
      '- ',
      '> ',
    ]) {
      expect(() => render(s)).not.toThrow()
    }
    expect(render('**half').text()).toContain('half')
  })
})
