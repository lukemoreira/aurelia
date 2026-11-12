// SPDX-License-Identifier: AGPL-3.0-or-later
// Evaluates an SPDX licence expression against an allowlist: AND needs both sides, OR needs
// either, parentheses group, AND binds tighter than OR. Anything else is refused, never
// guessed at: a check that fails open is worse than none.

const TOKEN = /\s*(\(|\)|[^\s()]+)/y

function tokenize(expr) {
  const tokens = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < expr.length) {
    const m = TOKEN.exec(expr)
    if (!m) break
    tokens.push(m[1])
  }
  return tokens
}

/** @param {string} expr @param {RegExp[]} allowed @returns {boolean} @throws on an expression it cannot read */
export function isAllowedExpression(expr, allowed) {
  const tokens = tokenize(String(expr ?? ''))
  let at = 0
  const fail = (why) => {
    throw new Error(`Cannot read licence expression "${expr}": ${why}`)
  }
  const isId = (t) => t !== undefined && !['(', ')', 'AND', 'OR', 'WITH'].includes(t)

  function atom() {
    const t = tokens[at++]
    if (t === '(') {
      const v = or()
      if (tokens[at++] !== ')') fail('missing )')
      return v
    }
    if (!isId(t)) fail(`unexpected ${t === undefined ? 'end' : `"${t}"`}`)
    return allowed.some((re) => re.test(t))
  }
  function and() {
    let v = atom()
    while (tokens[at] === 'AND') {
      at++
      const next = atom() // read both sides, so a malformed right side is still refused
      v = v && next
    }
    return v
  }
  function or() {
    let v = and()
    while (tokens[at] === 'OR') {
      at++
      const next = and()
      v = v || next
    }
    return v
  }

  const result = or()
  if (at < tokens.length) fail(`unexpected "${tokens[at]}"`)
  return result
}
