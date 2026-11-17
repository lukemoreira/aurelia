// SPDX-License-Identifier: AGPL-3.0-or-later
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { newId } from '@/domain/ids'
import type { StorageAdapter } from '@/storage/adapter'
import { reconnect, recents, reopen } from '@/storage/app'
import {
  browserAdapter,
  browserDirectory,
  canKeepInBrowser,
  discardBrowserDirectory,
  canPickFolder,
  pickFolder,
} from '@/storage/browser'
import type { ImportPlan } from '@/import/plan'
import { checkWorkspaceName, createWorkspace, inspectFolder } from '@/storage/create'
import { createImportedWorkspace } from '@/storage/import-actions'
import { regenerateOutlines } from '@/storage/outline-actions'
import { StorageError, wordsFor } from '@/storage/errors'
import type { RecentWorkspace } from '@/storage/recents'
import { useWorkspaceStore } from '@/stores/workspace'

export interface RecentRow {
  recent: RecentWorkspace
  /** A folder the browser needs the author's OK to open again. */
  needsAccess: boolean
}

export interface Message {
  kind: 'info' | 'error'
  text: string
}

/** "today", "yesterday" or "Nov 12": when a workspace was last opened, in words. */
export function openedWhen(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((day(now) - day(ms)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return new Date(ms).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/** On an http page the browser gives no file access at all: not a folder, not browser storage. */
export const INSECURE_REASON =
  'Open Aurelia at its https:// address. On http, the browser does not let it keep files.'
export const insecurePage = () => window.isSecureContext === false
export const NO_STORAGE_REASON =
  'This browser cannot keep files for Aurelia. It may be a private window.'

/** Everything the Welcome screen does: pick, create, reopen and reconnect. */
export function useOpenWorkspace() {
  const router = useRouter()
  const ws = useWorkspaceStore()
  const rows = ref<RecentRow[]>([])
  const message = ref<Message | null>(null)
  const busy = ref(false)
  /** Naming a new workspace, in a folder the author picked or in the browser. */
  const naming = ref<'folder' | 'browser' | null>(null)
  /** The Import dialog is open. */
  const importing = ref(false)
  let pendingFolder: StorageAdapter | null = null

  async function loadRecents() {
    const list = await recents.list().catch(() => [])
    const found = await Promise.all(
      list.map(async (recent) => ({ recent, state: await reopen(recent) })),
    )
    // A browser workspace the browser has since cleared is gone: forget it rather than offer it.
    for (const f of found)
      if ('gone' in f.state) void recents.remove(f.recent.key).catch(() => undefined)
    rows.value = found
      .filter((f) => !('gone' in f.state))
      .map((f) => ({ recent: f.recent, needsAccess: 'needsAccess' in f.state }))
  }
  onMounted(loadRecents)

  function explain(e: unknown): Message {
    return { kind: 'error', text: wordsFor(e, 'Aurelia could not open that workspace.') }
  }

  async function enter(adapter: StorageAdapter) {
    busy.value = true
    message.value = null
    try {
      await ws.open(adapter)
      await router.push(ws.startPath())
    } catch (e) {
      message.value = explain(e)
    } finally {
      busy.value = false
    }
  }

  async function chooseFolder() {
    message.value = null
    if (insecurePage()) {
      message.value = { kind: 'info', text: INSECURE_REASON }
      return
    }
    if (!canPickFolder()) {
      message.value = {
        kind: 'info',
        text: 'Choosing a folder needs Chrome or Edge. In this browser, use “Keep it in this browser”.',
      }
      return
    }
    try {
      const adapter = await pickFolder()
      if (!adapter) return
      const folder = await inspectFolder(adapter)
      if (folder.state === 'workspace') return await enter(adapter)
      if (folder.state === 'empty') {
        pendingFolder = adapter
        naming.value = 'folder'
        return
      }
      const shown = folder.names.slice(0, 3).join(', ')
      message.value = {
        kind: 'error',
        text: `That folder already has other files in it (${shown}${folder.names.length > 3 ? ', …' : ''}). Aurelia only writes into an empty folder or one it made, so nothing was changed. Make a new, empty folder and choose that.`,
      }
    } catch (e) {
      message.value = explain(e)
    }
  }

  function keepInBrowser() {
    message.value = null
    if (insecurePage()) {
      message.value = { kind: 'info', text: INSECURE_REASON }
      return
    }
    if (!canKeepInBrowser()) {
      message.value = { kind: 'error', text: NO_STORAGE_REASON }
      return
    }
    naming.value = 'browser'
  }

  async function createNamed(name: string) {
    busy.value = true
    try {
      let adapter: StorageAdapter
      if (naming.value === 'folder' && pendingFolder) {
        adapter = pendingFolder
        await createWorkspace(adapter, name)
      } else {
        const id = newId('wsp')
        adapter = browserAdapter(await browserDirectory(id, true))
        await createWorkspace(adapter, name, id)
      }
      naming.value = null
      pendingFolder = null
      await enter(adapter)
    } catch (e) {
      message.value = explain(e)
      naming.value = null
    } finally {
      busy.value = false
    }
  }

  /** Open a recent workspace; a folder the browser forgot is asked about again (this must be a click). */
  async function openRecent(row: RecentRow) {
    message.value = null
    if (row.needsAccess) {
      const adapter = await reconnect(row.recent)
      if (!adapter) {
        message.value = {
          kind: 'info',
          text: `The browser did not give Aurelia access to ${row.recent.label}, so it stays closed.`,
        }
        return
      }
      return enter(adapter)
    }
    const found = await reopen(row.recent)
    if ('adapter' in found) return enter(found.adapter)
    message.value = {
      kind: 'error',
      text: `${row.recent.name} is no longer where Aurelia left it.`,
    }
    await loadRecents()
  }

  /**
   * Import from the Welcome screen: a new workspace in this browser that holds the book alone, named after
   * it, then opened. A failure is thrown for the dialog to say; nothing else is touched.
   */
  async function importPlan(plan: ImportPlan, name: string) {
    if (insecurePage()) throw new StorageError('other', INSECURE_REASON)
    if (!canKeepInBrowser()) throw new StorageError('other', NO_STORAGE_REASON)
    const checked = checkWorkspaceName(name)
    if (!checked.ok) throw new StorageError('other', checked.error || 'Give the workspace a name.')
    busy.value = true
    let adapter: StorageAdapter
    const id = newId('wsp')
    try {
      adapter = browserAdapter(await browserDirectory(id, true))
      await createImportedWorkspace(adapter, checked.name, plan, id)
    } catch (e) {
      // A workspace that did not get made leaves nothing behind: no half-written folder in the browser.
      await discardBrowserDirectory(id).catch(() => undefined)
      throw e
    } finally {
      busy.value = false
    }
    await enter(adapter)
    if (ws.session) await regenerateOutlines(ws.session)
  }

  function openSample() {
    ws.loadSample()
    void router.push(ws.startPath())
  }

  return {
    rows,
    message,
    busy,
    naming,
    importing,
    importPlan,
    canPickFolder: canPickFolder(),
    insecure: insecurePage(),
    chooseFolder,
    keepInBrowser,
    createNamed,
    openRecent,
    openSample,
  }
}
