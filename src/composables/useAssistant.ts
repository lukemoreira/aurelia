// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, effectScope, ref, shallowRef } from 'vue'
import {
  agentState,
  askAgent,
  loginAgent,
  logoutAgent,
  sendLoginLine,
  type AgentState,
} from '@/assistant/client'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'

export interface ChatTurn {
  role: 'author' | 'assistant'
  text: string
  /** The assistant's activity, one line per tool call ("Read 6.3 The Customs House"). */
  tools: string[]
  error?: string
}

/** The author's message that starts the guided start; the system prompt says how it goes. */
export const GUIDED_START =
  'Set up the story base of this book with me: ask me one short question at a time, then propose it.'

function createAssistant() {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  const state = ref<AgentState>('absent')
  const turns = ref<ChatTurn[]>([])
  const busy = ref(false)
  const error = ref('')
  /** Claude Code's own sign-in, as its words arrive. Shown, never read or kept. */
  const loginText = ref('')
  const loginRunning = ref(false)
  const loginResult = ref<'ok' | 'failed' | null>(null)
  const loginAbort = shallowRef<AbortController | null>(null)
  /** Ticks after each answer, once the sync round that brings its proposals in has run. */
  const answered = ref(0)

  /** The assistant reads the copy on the server, so it needs this workspace kept in sync. */
  const folder = computed(() =>
    backup.view?.enabled && backup.view.mode === 'sync' ? backup.view.folder : null,
  )

  async function refresh() {
    state.value = await agentState()
  }

  /** Let pending saves land and run one sync round, so both sides hold the same text. */
  async function syncNow() {
    await ws.flush()
    await backup.backUpNow()
  }

  async function send(message: string): Promise<boolean> {
    const text = message.trim()
    if (!text || busy.value || !folder.value) return false
    busy.value = true
    error.value = ''
    const history = turns.value.map(({ role, text }) => ({ role, text }))
    turns.value.push({ role: 'author', text, tools: [] })
    const reply: ChatTurn = { role: 'assistant', text: '', tools: [] }
    turns.value.push(reply)
    const live = turns.value[turns.value.length - 1]!
    try {
      await syncNow()
      const ctx = ws.context
      const context = ctx
        ? `scene ${ctx.scene.meta.id} (“${ctx.scene.meta.title}”) in book ${ctx.book.id}`
        : ws.bookId
          ? `book ${ws.bookId}`
          : ''
      for await (const e of askAgent({ folder: folder.value, message: text, history, context })) {
        if (e.t === 'text') live.text += (live.text ? '\n\n' : '') + e.text
        else if (e.t === 'tool') live.tools.push(e.label)
        else if (!e.ok) live.error = e.error ?? 'The assistant stopped before it finished.'
      }
    } catch (e) {
      live.error = e instanceof Error ? e.message : 'The assistant did not answer.'
    } finally {
      busy.value = false
    }
    // Its proposals were written on the server: one more round brings them here.
    await syncNow().catch(() => undefined)
    answered.value++
    if (live.error) await refresh()
    return !live.error
  }

  /** The guided start (ADR-0016): the assistant asks one short question at a time, then proposes. */
  const guidedStart = () => send(GUIDED_START)

  async function startLogin(useConsole = false) {
    loginAbort.value?.abort()
    const abort = new AbortController()
    loginAbort.value = abort
    loginText.value = ''
    loginResult.value = null
    loginRunning.value = true
    try {
      for await (const e of loginAgent(useConsole, abort.signal)) {
        if (e.t === 'out') loginText.value += e.text
        else loginResult.value = e.ok ? 'ok' : 'failed'
      }
      // The answer ended without Claude Code's own end: the sign-in did not finish.
      if (loginResult.value === null && !abort.signal.aborted) loginResult.value = 'failed'
    } catch {
      if (!abort.signal.aborted) loginResult.value = 'failed'
    } finally {
      if (loginAbort.value === abort) loginRunning.value = false
      await refresh()
    }
  }

  /** The code Claude's page shows, typed by the person, passed to Claude Code as it is. */
  const sendLine = (line: string) => sendLoginLine(line)
  const cancelLogin = () => {
    loginAbort.value?.abort()
    loginRunning.value = false
  }

  async function disconnect() {
    await logoutAgent().catch(() => false)
    turns.value = []
    await refresh()
  }

  return {
    state,
    turns,
    busy,
    error,
    folder,
    answered,
    loginText,
    loginRunning,
    loginResult,
    refresh,
    send,
    guidedStart,
    startLogin,
    sendLine,
    cancelLogin,
    disconnect,
  }
}

const shared = new WeakMap<object, ReturnType<typeof createAssistant>>()

/** The assistant: whether there is one and who is signed in, the conversation, and Claude Code's own sign-in. */
export function useAssistant() {
  const ws = useWorkspaceStore()
  let it = shared.get(ws)
  if (!it) {
    it = effectScope(true).run(createAssistant)!
    shared.set(ws, it)
    void it.refresh()
  }
  return it
}
