// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { IconName } from '@/domain/ui-names'
import type { Entry } from '@/index/palette-entries'
import { rankByTitle } from '@/index/palette-search'
import type { ViewName } from '@/router'
import { useLayoutStore } from '@/stores/layout'
import { useShortcutsStore } from '@/stores/shortcuts'
import { useWorkspaceStore } from '@/stores/workspace'
import { altLabel, focusLabel, modLabel } from './useKeyboardShortcuts'
import { useNavigation } from './useNavigation'
import { useNewScene } from './useNewScene'
import { useOutlineEdits } from './useOutlineEdits'
import { useRecordEdits } from './useRecordEdits'
import { useEditsStore } from '@/stores/edits'
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

  const query = ref('')
  const highlighted = ref<string>()
  watch(
    () => layout.paletteOpen,
    (open) => {
      if (open) query.value = ''
      highlighted.value = undefined
    },
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
      // Outline editing and records: a real workspace that can be written to.
      ...(edit.canEdit.value ? editActions() : []),
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
    const keyed = (keys: string[], group: string) =>
      keys.flatMap((k) => ws.entryByKey.get(k) ?? []).map((e) => entryItem(e, group))
    const result: PaletteGroup[] = q
      ? [
          { label: 'Records', items: of(['record'], 'records') },
          { label: 'Scenes', items: of(['scene'], 'scenes') },
          { label: 'Books and chapters', items: of(['book', 'chapter'], 'books') },
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
