// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createRouter,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router'
import { useWorkspaceStore } from './stores/workspace'

export type ViewName = 'write' | 'plan' | 'continuity' | 'world' | 'map'

export const scenePath = (book: string, scene: string) => `/w/${book}/${scene}`
export const viewPath = (book: string, view: Exclude<ViewName, 'write'>) => `/w/${book}/${view}`

const placeholder = (path: string, title: string, blurb: string): RouteRecordRaw => ({
  path,
  name: path,
  component: () => import('./views/PlaceholderView.vue'),
  meta: { title, blurb },
})

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'welcome', component: () => import('./views/WelcomeView.vue') },
  { path: '/ui', component: () => import('./views/UiGallery.vue') },
  {
    path: '/w/:bookId',
    component: () => import('./components/shell/AppShell.vue'),
    meta: { needsWorkspace: true },
    children: [
      {
        path: 'plan',
        name: 'plan',
        component: () => import('./views/PlanView.vue'),
        meta: { title: 'Plan' },
      },
      placeholder('continuity', 'Continuity', 'Continuity checks arrive in v0.2.'),
      {
        path: 'world',
        name: 'world',
        component: () => import('./views/WorldView.vue'),
        meta: { title: 'World' },
      },
      {
        path: 'map',
        name: 'map',
        component: () => import('./views/MapView.vue'),
        meta: { title: 'Story map' },
      },
      { path: ':sceneId?', name: 'write', component: () => import('./views/WriteView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/** A workspace route needs a loaded workspace and a book that is in it. */
async function workspaceGuard(to: RouteLocationNormalized) {
  if (!to.meta.needsWorkspace) return true
  const ws = useWorkspaceStore()
  const bookId = String(to.params.bookId)
  if (!(await ws.ensureLoaded()) || !ws.hasBook(bookId)) return '/'
  if (to.name !== 'write') return true
  const wanted = typeof to.params.sceneId === 'string' ? to.params.sceneId : undefined
  const sceneId = ws.sceneFor(bookId, wanted)
  if (!sceneId) return viewPath(bookId, 'plan')
  return sceneId === wanted
    ? true
    : { path: scenePath(bookId, sceneId), query: to.query, replace: true }
}

export function createAppRouter(history: RouterHistory) {
  const router = createRouter({ history, routes })
  router.beforeEach(workspaceGuard)
  return router
}
