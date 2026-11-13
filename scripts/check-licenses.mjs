// SPDX-License-Identifier: AGPL-3.0-or-later
// Fails on any package that ends up in what we ship — production dependencies and the build-time
// packages copied into the service worker — whose licence is not on the allowlist.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isAllowedExpression } from './license-expr.mjs'

const ALLOWED = [
  /^MIT$/,
  /^ISC$/,
  /^BSD-2-Clause$/,
  /^BSD-3-Clause$/,
  /^0BSD$/,
  /^Apache-2\.0$/,
  /^MPL-2\.0$/,
  /^LGPL-2\.1-or-later$/,
  /^LGPL-3\.0/,
  /^GPL-3\.0/,
  /^AGPL-3\.0/,
  /^OFL-1\.1$/,
  /^CC0-1\.0$/,
  /^Unlicense$/,
  /^BlueOak-1\.0\.0$/,
  /^Python-2\.0$/,
  /^CC-BY-4\.0$/,
]

/**
 * Build-time packages whose code is copied into what we ship. `dist/workbox-*.js`, the runtime
 * `sw.js` loads, contains exactly these (grep it for "workbox:"); re-check after a plugin upgrade.
 */
const SHIPPED_BUILD_TIME = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
]

/** A licence that cannot be read counts as not allowed. */
function isAllowed(expr) {
  try {
    return isAllowedExpression(expr, ALLOWED)
  } catch {
    return false
  }
}

function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(' OR ')
  return typeof l === 'object' && l ? l.type : l
}

// Resolve a package the way Node does: walk up from the requirer's directory.
function find(name, from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(file)) return file
    if (dirname(dir) === dir) return null
  }
}

const root = JSON.parse(readFileSync('package.json', 'utf8'))
const seen = new Map()
const bad = []

function visit(name, from) {
  const file = find(name, from)
  if (!file) return // optional or platform-specific package not installed
  const dir = dirname(file)
  if (seen.has(dir)) return
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  const license = licenseOf(pkg)
  seen.set(dir, license)
  if (!license || !isAllowed(license))
    bad.push(`${pkg.name}@${pkg.version}: ${license ?? 'no licence'}`)
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }))
    visit(dep, dir)
}

for (const dep of [...Object.keys(root.dependencies ?? {}), ...SHIPPED_BUILD_TIME])
  visit(dep, process.cwd())

// The storage server (server/store) ships its production dependencies in its own image. Its lockfile
// lists every package with its licence, so this needs no install. `dev` packages are not shipped.
const storeLock = JSON.parse(readFileSync('server/store/package-lock.json', 'utf8'))
let storeCount = 0
for (const [path, pkg] of Object.entries(storeLock.packages ?? {})) {
  if (path === '' || pkg.dev || pkg.devOptional) continue
  storeCount++
  const license = licenseOf(pkg)
  if (!license || !isAllowed(license))
    bad.push(
      `${path.replace(/^node_modules\//, '')}@${pkg.version} (server/store): ${license ?? 'no licence'}`,
    )
}

if (bad.length) {
  console.error(`Licences outside the allowlist:\n${bad.join('\n')}`)
  process.exit(1)
}
console.log(
  `Licences OK (${seen.size} packages shipped to users, ${storeCount} in the storage server)`,
)
