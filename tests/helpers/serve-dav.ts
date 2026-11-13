// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BrowserContext } from '@playwright/test'
import type { FakeDav } from './fake-dav'

/** Answer `/dav/` for every page of a browser context from an in-test memory WebDAV. */
export async function serveDav(context: BrowserContext, dav: FakeDav) {
  await context.route('**/dav/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const r = dav.handle({
      method: request.method(),
      path: decodeURIComponent(url.pathname).replace(/^\/dav\/?/, ''),
      headers: request.headers(),
      body: request.postDataBuffer(),
    })
    await route.fulfill({
      status: r.status,
      headers: r.headers,
      body:
        typeof r.body === 'string' || r.body === null ? (r.body ?? undefined) : Buffer.from(r.body),
    })
  })
}
