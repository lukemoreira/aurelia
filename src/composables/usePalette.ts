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
import { altLabel, modLabel } from './useKeyboardShortcuts'
import { useNavigation } from './useNavigation'
import { useTheme } from './useTheme'

export interface PaletteItem {
  /** Unique in the list: an entry can show under Pinned and under Recent. */
  id: string
  title: string
  sub: string
  icon: IconName
  hint?: string
  color?: string
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
  const router = useRouter()
  const { resolved, setTheme } = useTheme()

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

  const actions = computed<PaletteItem[]>(() => {
    const dark = resolved.value === 'dark'
    const navShown = layout.wide ? !layout.nav.collapsed : layout.navSheet
    const inspectorShown = layout.wide ? !layout.inspector.collapsed : layout.inspectorSheet
    const book = ws.book
    return [
      {
        id: 'action:theme',
        title: dark ? 'Switch to the light theme' : 'Switch to the dark theme',
        sub: 'Appearance',
        icon: dark ? 'sun' : 'moon',
        run: () => setTheme(dark ? 'light' : 'dark'),
      },
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
    layout.paletteOpen = false
    item.run()
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
