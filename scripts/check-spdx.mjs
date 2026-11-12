// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const ID = 'SPDX-License-Identifier: AGPL-3.0-or-later'
const EXT = new Set(['.ts', '.vue', '.js', '.mjs', '.css'])

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )

// Source, tests, scripts and public scripts, plus the config files and page at the root.
const rootFiles = readdirSync('.').filter((f) => /^(.+\.config\.(ts|js|mjs)|index\.html)$/.test(f))
const files = [...['src', 'tests', 'scripts', 'public'].flatMap(walk), ...rootFiles].filter(
  (f) => EXT.has(extname(f)) || f === 'index.html',
)

const missing = files.filter((f) => !readFileSync(f, 'utf8').split('\n', 3).join('\n').includes(ID))

if (missing.length) {
  console.error(`Missing "${ID}" in the first 3 lines of:\n${missing.join('\n')}`)
  process.exit(1)
}
console.log(`SPDX headers OK (${files.length} files)`)
