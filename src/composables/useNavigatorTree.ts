// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import type { IconName } from '@/domain/ui-names'
import type { OutlineChapter } from '@/domain/outline'
import { bookOutline, bookWords, formatWords, outlineScenes } from '@/domain/outline'
import type { RecordFrontmatter } from '@/domain/schema/record'
import type { WorkspaceData } from '@/domain/workspace-data'
import { fold } from '@/index/palette-search'
import { entryKey } from '@/index/palette-entries'
import { useWorkspaceStore } from '@/stores/workspace'
import { isStringArray, uniqueStrings, usePersisted } from './usePersisted'
import type { TreeNode } from './useTree'

type RecordType = RecordFrontmatter['type']

const LIBRARY: { id: string; label: string; icon: IconName; types: RecordType[] }[] = [
  { id: 'characters', label: 'Characters', icon: 'user', types: ['character'] },
  { id: 'places', label: 'Worlds & places', icon: 'place', types: ['world', 'place'] },
  { id: 'items', label: 'Items', icon: 'item', types: ['item'] },
  { id: 'events', label: 'Events & timeline', icon: 'event', types: ['event'] },
  { id: 'arcs', label: 'Arcs', icon: 'arc', types: ['arc'] },
  { id: 'lore', label: 'Lore', icon: 'lore', types: ['lore', 'faction', 'culture', 'system'] },
  { id: 'research', label: 'Research', icon: 'research', types: ['research', 'note'] },
]

const chapterNode = (c: OutlineChapter): TreeNode => ({
  id: c.chapter.id,
  label: `${c.number} · ${c.chapter.title}`,
  icon: 'chapter',
  meta: formatWords(c.words),
  pinKey: entryKey('chapter', c.chapter.id),
  children: c.scenes.map((s) => ({
    id: s.meta.id,
    label: s.meta.title,
    icon: 'scene' as const,
    ...(s.meta.status ? { status: s.meta.status } : {}),
    meta: formatWords(s.words),
    pinKey: entryKey('scene', s.meta.id),
  })),
})

function bookNode(data: WorkspaceData, bookId: string): TreeNode | undefined {
  const book = data.books.find((b) => b.id === bookId)
  if (!book) return undefined
  const outline = bookOutline(data, bookId)
  const children = outline.flatMap((group): TreeNode[] =>
    group.part
      ? [
          {
            id: group.part.id,
            label: group.part.title,
            icon: 'part',
            children: group.chapters.map(chapterNode),
          },
        ]
      : group.chapters.map(chapterNode),
  )
  return {
    id: bookId,
    label: book.title,
    icon: book.mode === 'branching' ? 'branch' : 'book',
    meta:
      book.mode === 'branching'
        ? `${outlineScenes(outline).length} sc.`
        : formatWords(bookWords(data, bookId)),
    pinKey: entryKey('book', bookId),
    children,
  }
}

export const idsOf = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => [n.id, ...idsOf(n.children ?? [])])

/** Keep a node when it, or something under it, matches. A parent of a match stays open. */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = fold(query)
  if (!q) return nodes
  return nodes.flatMap((n): TreeNode[] => {
    const kids = filterTree(n.children ?? [], query)
    if (kids.length) return [{ ...n, children: kids }]
    return fold(n.label).includes(q) ? [{ ...n, children: undefined }] : []
  })
}

/** The navigator's three trees, the filter over them, and which branches are open. */
export function useNavigatorTree() {
  const ws = useWorkspaceStore()
  const filter = ref('')
  const stored = usePersisted<string[]>('navigator.expanded', [], isStringArray, uniqueStrings)

  const books = computed(() => {
    const data = ws.data
    const universe = ws.universe
    if (!data || !universe) return []
    return filterTree(
      universe.books.flatMap((id) => bookNode(data, id) ?? []),
      filter.value,
    )
  })
  const standalone = computed(() => {
    const data = ws.data
    if (!data) return []
    const others = data.universes.filter((u) => u.kind === 'standalone' && u.id !== ws.universe?.id)
    const nodes = others
      .flatMap((u) => u.books)
      .flatMap((id): TreeNode[] => {
        const book = data.books.find((b) => b.id === id)
        if (!book) return []
        const genre = (book as { genre?: unknown }).genre
        return [
          {
            id,
            label: book.title,
            icon: 'book',
            ...(typeof genre === 'string' ? { meta: genre } : {}),
          },
        ]
      })
    return filterTree(nodes, filter.value)
  })
  const library = computed(() => {
    const data = ws.data
    const universe = ws.universe
    if (!data || !universe || universe.kind !== 'shared') return []
    // Counts come from the records themselves; a group with none is not shown.
    const nodes = LIBRARY.flatMap((g): TreeNode[] => {
      const children = data.records
        .filter(
          (r) =>
            r.universe === universe.id &&
            r.meta.scope === 'universe' &&
            g.types.includes(r.meta.type),
        )
        .map((r) => ({
          id: r.meta.id,
          label: r.meta.title,
          icon: g.icon,
          pinKey: entryKey('record', r.meta.id),
        }))
      return children.length
        ? [
            {
              id: `lib:${g.id}`,
              label: g.label,
              icon: g.icon,
              meta: String(children.length),
              children,
            },
          ]
        : []
    })
    return filterTree(nodes, filter.value)
  })

  const filtering = computed(() => filter.value.trim() !== '')
  const expanded = computed({
    get: () => (filtering.value ? idsOf([...books.value, ...library.value]) : stored.value),
    set: (ids: string[]) => {
      if (!filtering.value) stored.value = ids
    },
  })

  // Keep the open scene's book, part and chapter open, so it is always in view.
  watch(
    () => ws.sceneId,
    () => {
      const ctx = ws.context
      if (!ctx) return
      const open = [ctx.book.id, ctx.part?.id, ctx.chapter.chapter.id].filter(
        (id): id is string => !!id,
      )
      const missing = open.filter((id) => !stored.value.includes(id))
      if (missing.length) stored.value = [...stored.value, ...missing]
    },
    { immediate: true },
  )

  return { filter, books, standalone, library, expanded }
}
