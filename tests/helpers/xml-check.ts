// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small well-formedness check for the XML an export writes: tags nest and close, attribute values are
 * quoted, and a bare `&` or `<` in text is an error. Throws a line saying what is wrong.
 */
export function assertWellFormed(xml: string): void {
  const stack: string[] = []
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y
  let at = 0
  let roots = 0
  while (at < xml.length) {
    const lt = xml.indexOf('<', at)
    const text = xml.slice(at, lt < 0 ? xml.length : lt)
    if (/&(?!(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/.test(text))
      throw new Error(`a bare & near "${text.slice(0, 40)}"`)
    if (!stack.length && text.trim()) throw new Error('text outside the root')
    if (lt < 0) break
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt)
      if (end < 0) throw new Error('an unclosed <?')
      at = end + 2
      continue
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt)
      if (end < 0) throw new Error('an unclosed <!')
      at = end + 1
      continue
    }
    tag.lastIndex = lt
    const m = tag.exec(xml)
    if (!m) throw new Error(`a broken tag near "${xml.slice(lt, lt + 40)}"`)
    const [whole, close, name, , selfClose] = m
    if (close) {
      if (stack.pop() !== name) throw new Error(`</${name}> does not close the open tag`)
    } else if (!selfClose) {
      if (!stack.length) roots++
      stack.push(name!)
    } else if (!stack.length) roots++
    at = lt + whole.length
  }
  if (stack.length) throw new Error(`<${stack.at(-1)}> is never closed`)
  if (roots !== 1) throw new Error(`${roots} root elements`)
}
