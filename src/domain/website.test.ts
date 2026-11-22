// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { websiteLink } from './website'

describe('the link a book’s website makes', () => {
  it('follows an http or https address as it is', () => {
    expect(websiteLink('https://example.com/book')).toBe('https://example.com/book')
    expect(websiteLink(' http://example.com ')).toBe('http://example.com/')
  })
  it('turns a bare domain into an https address, with a port or a path', () => {
    expect(websiteLink('example.com')).toBe('https://example.com/')
    expect(websiteLink('www.example.com/the-book')).toBe('https://www.example.com/the-book')
    expect(websiteLink('example.com:8080/x')).toBe('https://example.com:8080/x')
  })
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'mailto:me@example.com',
    'file:///etc/passwd',
    'ftp://example.com',
    '//example.com',
    'my book website',
    'localhost',
    '',
  ])('never links %j', (typed) => {
    expect(websiteLink(typed)).toBeUndefined()
  })
  it('links nothing when there is nothing', () => expect(websiteLink(undefined)).toBeUndefined())
})
