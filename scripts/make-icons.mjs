// SPDX-License-Identifier: AGPL-3.0-or-later
// Renders public/icons/icon.svg to the PNG sizes the app manifest names.
// Run with `node scripts/make-icons.mjs`; the PNGs are committed.
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const svg = readFileSync('public/icons/icon.svg', 'utf8')
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  writeFileSync(`public/icons/icon-${size}.png`, await page.screenshot({ omitBackground: true }))
}
await browser.close()
