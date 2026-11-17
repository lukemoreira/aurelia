// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed } from 'vue'
import { stateRows, type StateItem } from '@/domain/continuity-views'
import { useWorkspaceStore } from '@/stores/workspace'
import { useContinuityModel } from './useContinuityModel'

const words = (i: StateItem) =>
  `${i.text}${i.since ? ` since ${i.since}` : ''}${i.some ? ' (on some paths)' : ''}`

/**
 * What a character's hover card says about the open scene (the "state at this scene" of the Main
 * design): how they are, who they stand with, what they hold, and how often they are on the page.
 * Nothing for anyone who is not a character of this book.
 */
export function useCardState(id: () => string | undefined) {
  const ws = useWorkspaceStore()
  const { model } = useContinuityModel()
  const lines = computed(() => {
    const m = model.value
    const who = id()
    if (!m || !ws.sceneId || !who || !m.characters.has(who)) return []
    const rows = stateRows(m, ws.sceneId, who)
    const of = (label: string) => rows.find((r) => r.label === label)?.items ?? []
    const out: { label: string; text: string }[] = []
    const here = ['Status', 'Condition', 'Where'].flatMap((l) => of(l).map(words))
    if (here.length) out.push({ label: 'At this scene', text: here.join(' · ') })
    if (of('Relationships').length)
      out.push({ label: 'Relations', text: of('Relationships').map(words).join('; ') })
    if (of('Holds').length) out.push({ label: 'Holds', text: of('Holds').map(words).join(', ') })
    const n = m.scenes.filter((s) => m.presence.get(s.id)!.present.has(who)).length
    out.push({ label: 'Appears', text: `${n} ${n === 1 ? 'scene' : 'scenes'} in this book` })
    return out
  })
  return { lines }
}
