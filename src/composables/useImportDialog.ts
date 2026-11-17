// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { ImportError } from '@/import/limits'
import { planStats, type ImportPlan } from '@/import/plan'
import { checkTitle } from '@/domain/titles'
import { scenePath } from '@/router'
import { checkWorkspaceName } from '@/storage/create'
import { wordsFor } from '@/storage/errors'
import { importBook } from '@/storage/import-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'

export type ImportInto =
  /** A new book in the open workspace. */
  | { kind: 'workspace' }
  /** The Welcome screen: a new workspace in this browser that holds the book. */
  | { kind: 'new'; make: (plan: ImportPlan, title: string) => Promise<void> }

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What the author is told when the book is made: what it is, and how many files were left out. */
function toastWords(plan: ImportPlan, title: string): string {
  const { chapters, scenes } = planStats(plan)
  const left = plan.report.unread.reduce((n, i) => n + i.names.length, 0)
  return `Imported “${title.trim()}”: ${count(chapters, 'chapter')}, ${count(scenes, 'scene')}.${left ? ` ${count(left, 'file')} ${left === 1 ? 'was' : 'were'} not read.` : ''}`
}

/**
 * The Import dialog: pick what to bring in, read it into a plan (nothing is written), show what will be made and what
 * could not be read, and only then make the book. Always a new book: nothing already in the workspace is touched.
 */
export function useImportDialog(open: Ref<boolean>, into: () => ImportInto) {
  const ws = useWorkspaceStore()
  const router = useRouter()
  const edits = useEditsStore()
  const step = ref<'pick' | 'reading' | 'preview' | 'making'>('pick')
  const plan = shallowRef<ImportPlan | null>(null)
  const title = ref('')
  const error = ref('')
  /** Which picker the files came from, so only its button shows that it is working. */
  const via = ref<'files' | 'folder'>('files')

  watch(open, (isOpen) => {
    if (isOpen) back()
  })

  /** The name in the box, checked the way a book's (or, on the Welcome screen, a workspace's) name is. */
  const nameCheck = computed(() =>
    into().kind === 'new' ? checkWorkspaceName(title.value) : checkTitle(title.value),
  )
  const stats = computed(() => (plan.value ? planStats(plan.value) : null))
  /** Where a book made in the workspace goes when that is a shared universe (else it is a book of its own, which needs no words). */
  const where = computed(() => (ws.universe?.kind === 'shared' ? ` in ${ws.universe.title}` : ''))

  function back() {
    step.value = 'pick'
    plan.value = null
    error.value = ''
  }

  /** Read what was picked: files, a folder (with its paths) or a zip. */
  async function pick(files: File[], from: 'files' | 'folder' = 'files') {
    if (!files.length) return
    via.value = from
    step.value = 'reading'
    error.value = ''
    try {
      const { fromBrowserFiles, planFromFiles } = await import('@/import/sources')
      const source = fromBrowserFiles(files)
      plan.value = await planFromFiles(source.files, source.name)
      title.value = plan.value.title
      step.value = 'preview'
    } catch (e) {
      step.value = 'pick'
      error.value =
        e instanceof ImportError ? e.message : wordsFor(e, 'Aurelia could not read that.')
    }
  }

  async function make() {
    const current = plan.value
    const target = into()
    if (!current || step.value === 'making' || !nameCheck.value.ok) return
    step.value = 'making'
    error.value = ''
    try {
      if (target.kind === 'new') await target.make(current, title.value)
      else if (ws.session) {
        const made = await importBook(ws.session, current, {
          title: title.value,
          ...(ws.universe?.kind === 'shared' ? { universeId: ws.universe.id } : {}),
        })
        await router.push(made.scene ? scenePath(made.book, made.scene) : '/')
      }
      open.value = false
      edits.toast = { text: toastWords(current, title.value) }
    } catch (e) {
      step.value = 'preview'
      error.value = wordsFor(e, 'Aurelia could not make the book. Nothing you had was changed.')
    }
  }

  return { step, plan, title, error, via, nameCheck, stats, where, pick, make, back }
}
