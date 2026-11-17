// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { IconName } from '@/domain/ui-names'
import { entryKey, type Entry } from '@/index/palette-entries'
import { rankByTitle } from '@/index/palette-search'
import type { ViewName } from '@/router'
import { wordsFor } from '@/storage/errors'
import { setBookMode } from '@/storage/story-actions'
import { useLayoutStore } from '@/stores/layout'
import { useShortcutsStore } from '@/stores/shortcuts'
import { useWorkspaceStore } from '@/stores/workspace'
import { altLabel, focusLabel, modLabel } from './useKeyboardShortcuts'
import { useNavigation } from './useNavigation'
import { useAddChange } from './useAddChange'
import { useNewScene } from './useNewScene'
import { useOutlineEdits } from './useOutlineEdits'
import { useRecordEdits } from './useRecordEdits'
import { useEditorStore } from '@/stores/editor'
import { useEditsStore } from '@/stores/edits'
import { useReviewStore } from '@/stores/review'
import { takeWithToast } from './useHistory'
import { useRenameReason } from './useRenameWorkspace'
import { useTheme } from './useTheme'

export interface PaletteItem {
  /** Unique in the list: an entry can show under Pinned and under Recent. */
  id: string
  title: string
  sub: string
  icon: IconName
  hint?: string
  color?: string
  /** Opens a dialog: runs once the palette has closed and focus is back where it was. */
  afterClose?: boolean
  /** Shown but not available: `sub` says why. */
  disabled?: boolean
  /** The entry key a pin toggles. Actions have none. */
  pinKey?: string
  /** Where the words found stand in `sub`, drawn in bold. */
  marks?: [start: number, end: number][]
  run: () => void
}
interface PaletteGroup {
  label: string
  items: PaletteItem[]
}

const PER_GROUP = 8
const VIEWS: { view: ViewName; label: string; icon: IconName }[] = [
  { view: 'write', label: 'Write', icon: 'write' },
  { view: 'plan', label: 'Plan', icon: 'plan' },
  { view: 'map', label: 'Story map', icon: 'branch' },
  { view: 'continuity', label: 'Continuity', icon: 'continuity' },
  { view: 'world', label: 'World', icon: 'globe' },
]

/** What the command palette lists for a query, and what a pin or a choice does. */
export function usePalette() {
  const ws = useWorkspaceStore()
  const layout = useLayoutStore()
  const shortcuts = useShortcutsStore()
  const nav = useNavigation()
  const newScene = useNewScene()
  const router = useRouter()
  const { resolved, setTheme } = useTheme()
  const renameReason = useRenameReason()
  const edit = useOutlineEdits()
  const records = useRecordEdits()
  const edits = useEditsStore()
  const editor = useEditorStore()
  const review = useReviewStore()
  const addChange = useAddChange()

  /** Switch the open book to a branching story, and go to its map. */
  async function makeBranching() {
    const bookId = ws.bookId
    if (!ws.session || !bookId) return
    try {
      await setBookMode(ws.session, bookId, 'branching')
      await nav.openView('map')
    } catch (e) {
      edits.toast = { text: wordsFor(e, 'That did not work. Nothing was lost.'), error: true }
    }
  }

  const query = ref('')
  const highlighted = ref<string>()
  watch(
    () => layout.paletteOpen,
    (open) => {
      if (open) addChange.rememberSelection() // before the palette takes the keyboard
      if (open) query.value = ''
      highlighted.value = undefined
    },
    { flush: 'sync' },
  )

  const entryItem = (e: Entry, group: string): PaletteItem => ({
    id: `${group}:${e.key}`,
    title: e.title,
    sub: e.sub,
    icon: e.icon,
    ...(e.hint ? { hint: e.hint } : {}),
    ...(e.color ? { color: e.color } : {}),
    pinKey: e.key,
    run: () => void nav.openEntry(e),
  })

  /** What the author can add or undo from anywhere. The ones that ask for a name open a dialog once the palette is closed. */
  function editActions(): PaletteItem[] {
    const dialog = (id: string, title: string, sub: string, run: () => void): PaletteItem => ({
      id: `action:${id}`,
      title,
      sub,
      icon: 'plus',
      afterClose: true,
      run,
    })
    return [
      dialog('new-book', 'New book…', 'Outline', () => edit.newBook()),
      {
        id: 'action:new-part',
        title: 'New part',
        sub: `Outline · ${ws.book?.title ?? ''}`,
        icon: 'part',
        run: () => void edit.newPart(),
      },
      {
        id: 'action:new-chapter',
        title: 'New chapter',
        sub: `Outline · ${ws.book?.title ?? ''}`,
        icon: 'chapter',
        run: () => void edit.newChapter(),
      },
      dialog('new-character', 'New character…', 'World', () => records.newRecord('character')),
      dialog('new-place', 'New place…', 'World', () => records.newRecord('place')),
      {
        id: 'action:trash',
        title: 'Recently deleted…',
        sub: 'Outline',
        icon: 'trash',
        afterClose: true,
        run: () => (edits.trashOpen = true),
      },
    ]
  }

  /** Take a snapshot of the open scene or book right now, with no name; the toast says where it is. */
  const snapshotAction = (kind: 'scene' | 'book', id: string, title: string): PaletteItem => ({
    id: `action:snapshot-${kind}`,
    title: `Take snapshot of this ${kind}`,
    sub: `History · ${title}`,
    icon: 'plus',
    run: () => void takeWithToast({ kind, id }),
  })

  const actions = computed<PaletteItem[]>(() => {
    const dark = resolved.value === 'dark'
    const navShown = layout.wide ? !layout.nav.collapsed : layout.navSheet
    const inspectorShown = layout.wide ? !layout.inspector.collapsed : layout.inspectorSheet
    const book = ws.book
    const chapter = ws.context?.chapter.chapter
    return [
      // Only in a real workspace that can be written to; the sample is a read-only tour.
      ...(chapter && ws.view && !ws.view.readOnly
        ? [
            {
              id: 'action:new-scene',
              title: 'New scene in this chapter',
              sub: `Write · ${chapter.title}`,
              icon: 'plus' as const,
              run: () => void newScene(),
            },
          ]
        : []),
      // Continuity: words selected in the text become the quote of the change.
      ...(addChange.available.value
        ? [
            {
              id: 'action:add-change',
              // Both names start "Add a change": the writer finds it the same way, words selected or not.
              title: edits.selectedText
                ? 'Add a change from the selected text…'
                : 'Add a change to this scene…',
              sub: `Continuity · ${modLabel} ${altLabel} M`,
              icon: 'continuity' as const,
              afterClose: true,
              run: addChange.fromRemembered,
            },
          ]
        : []),
      // Outline editing and records: a real workspace that can be written to.
      ...(edit.canEdit.value ? editActions() : []),
      // Snapshots go in the workspace's own folder: only a real one that can be written to.
      ...(edit.canEdit.value && ws.sceneId
        ? [snapshotAction('scene', ws.sceneId, ws.scene?.meta.title ?? '')]
        : []),
      ...(edit.canEdit.value && book ? [snapshotAction('book', book.id, book.title)] : []),
      // A straight book has no Story map tab: this is the way to it from anywhere.
      ...(book && book.mode !== 'branching' && edit.canEdit.value
        ? [
            {
              id: 'action:make-branching',
              title: 'Make this a branching story',
              sub: `Book · ${book.title}`,
              icon: 'branch' as const,
              run: () => void makeBranching(),
            },
          ]
        : []),
      // Backup belongs to a real workspace; the sample has none.
      ...(ws.view
        ? [
            {
              id: 'action:backup',
              title: 'Backup and versions',
              sub: 'Storage',
              icon: 'cloud' as const,
              run: () => (layout.backupOpen = true),
            },
          ]
        : []),
      // Not in the sample, which is only a tour.
      ...(ws.view
        ? [
            {
              id: 'action:rename',
              title: 'Rename workspace…',
              sub: renameReason.value ?? 'Workspace',
              icon: 'write' as const,
              disabled: !!renameReason.value,
              afterClose: true,
              run: () => (layout.renameOpen = true),
            },
          ]
        : []),
      {
        id: 'action:theme',
        title: dark ? 'Switch to the light theme' : 'Switch to the dark theme',
        sub: 'Appearance',
        icon: dark ? 'sun' : 'moon',
        run: () => setTheme(dark ? 'light' : 'dark'),
      },
      // Focus mode belongs to the scene on screen.
      ...(ws.context && router.currentRoute.value.name === 'write'
        ? [
            {
              id: 'action:focus',
              title: layout.focus ? 'Leave focus mode' : 'Focus mode',
              sub: 'Layout',
              icon: 'focus' as const,
              hint: focusLabel,
              run: layout.toggleFocus,
            },
          ]
        : []),
      // Names found in the text belong to the scene on screen.
      ...(ws.context && router.currentRoute.value.name === 'write'
        ? [
            {
              id: 'action:names',
              title: editor.showNames ? 'Hide names' : 'Show names',
              sub: 'View',
              icon: 'user' as const,
              run: () => (editor.showNames = !editor.showNames),
            },
          ]
        : []),
      {
        id: 'action:navigator',
        title: `${navShown ? 'Hide' : 'Show'} the navigator`,
        sub: 'Layout',
        icon: 'panel-left',
        hint: `${modLabel} \\`,
        run: layout.toggleNavigator,
      },
      {
        id: 'action:inspector',
        title: `${inspectorShown ? 'Hide' : 'Show'} the inspector`,
        sub: 'Layout',
        icon: 'panel-right',
        hint: `${modLabel} ${altLabel} \\`,
        run: layout.toggleInspector,
      },
      ...VIEWS.filter((v) => v.view !== 'map' || book?.mode === 'branching').map(
        (v): PaletteItem => ({
          id: `action:view-${v.view}`,
          title: `Go to ${v.label}`,
          sub: book ? `View · ${book.title}` : 'View',
          icon: v.icon,
          run: () => void nav.openView(v.view),
        }),
      ),
      {
        id: 'action:gallery',
        title: 'Open the UI gallery',
        sub: 'Design system',
        icon: 'settings',
        run: () => void router.push('/ui'),
      },
    ]
  })

  const groups = computed<PaletteGroup[]>(() => {
    const q = query.value.trim()
    const of = (kind: Entry['kind'][], group: string) =>
      rankByTitle(
        ws.entries.filter((e) => kind.includes(e.kind)),
        q,
      )
        .slice(0, PER_GROUP)
        .map((e) => entryItem(e, group))
    /** Words found in scenes and notes, and other names, not already listed by their titles. */
    const inText = (listed: PaletteItem[]) => {
      const shown = new Set(listed.map((i) => i.pinKey))
      return ws.index
        .search(q, PER_GROUP * 2)
        .flatMap((hit) => {
          const entry = ws.entryByKey.get(entryKey(hit.kind, hit.id))
          if (!entry || shown.has(entry.key)) return []
          const item = entryItem(entry, 'text')
          return [
            {
              ...item,
              sub: hit.snippet ?? `${entry.sub} · another name`,
              ...(hit.marks ? { marks: hit.marks } : {}),
              // Opened at the word: the scene or the sheet selects it once it is on screen.
              run: () => {
                if (hit.term) review.found = { id: hit.id, term: hit.term }
                void nav.openEntry(entry)
              },
            },
          ]
        })
        .slice(0, PER_GROUP)
    }
    const keyed = (keys: string[], group: string) =>
      keys.flatMap((k) => ws.entryByKey.get(k) ?? []).map((e) => entryItem(e, group))
    const titled = q
      ? {
          records: of(['record'], 'records'),
          scenes: of(['scene'], 'scenes'),
          books: of(['book', 'chapter'], 'books'),
        }
      : null
    const result: PaletteGroup[] = titled
      ? [
          { label: 'Records', items: titled.records },
          { label: 'Scenes', items: titled.scenes },
          { label: 'Books and chapters', items: titled.books },
          {
            label: 'In your writing',
            items: inText([...titled.records, ...titled.scenes, ...titled.books]),
          },
          { label: 'Actions', items: rankByTitle(actions.value, q).slice(0, PER_GROUP) },
        ]
      : [
          { label: 'Pinned', items: keyed(shortcuts.pinned, 'pinned') },
          { label: 'Recent', items: keyed(shortcuts.recent, 'recent') },
          { label: 'Actions', items: actions.value },
        ]
    return result.filter((g) => g.items.length)
  })

  const items = computed(() => groups.value.flatMap((g) => g.items))
  /** The ids of every result, joined: changes exactly when the list does. */
  const resultIds = computed(() => items.value.map((i) => i.id).join('|'))

  function choose(item: PaletteItem) {
    if (item.disabled) return
    layout.paletteOpen = false
    if (item.afterClose) layout.paletteThen = item.run
    else item.run()
  }
  /** Pin or unpin the highlighted result: the keyboard way to what the pin button does. */
  function togglePinHighlighted() {
    const key = items.value.find((i) => i.id === highlighted.value)?.pinKey
    if (key) shortcuts.togglePin(key)
  }

  return {
    query,
    groups,
    items,
    resultIds,
    highlighted,
    choose,
    togglePinHighlighted,
    isPinned: shortcuts.isPinned,
  }
}
