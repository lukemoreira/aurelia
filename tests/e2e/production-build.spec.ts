// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const scripts = (dir: string) =>
  readdirSync(join(dir, 'assets'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, 'assets', f), 'utf8'))

test('the production build has no test hook, and the end-to-end build does', () => {
  expect(scripts('dist').filter((js) => js.includes('__aureliaTest'))).toHaveLength(0)
  expect(scripts('dist').filter((js) => js.includes('killed before the swap'))).toHaveLength(0)
  expect(scripts('dist-e2e').filter((js) => js.includes('__aureliaTest'))).not.toHaveLength(0)
})
