// SPDX-License-Identifier: AGPL-3.0-or-later
// What a scene or a record links to, names and is named by: read from the index's per-file
// analyses, never stored. The index class hands itself in.
import { fold } from './palette-search'
import type { Analysis, DocumentInfo, FoundName, OpenQuestion, OutLink, Target } from './types'

/** What the reports read of the index. */
export interface ReportSource {
  analysis(id: string): Analysis | undefined
  targetOf(id: string): Target | undefined
  documents(): DocumentInfo[]
}

/** What `id`'s text links to or names, and links that point nowhere or at several things. */
export function linksTo(index: ReportSource, id: string): OutLink[] {
  const a = index.analysis(id)
  if (!a) return []
  const out = new Map<string, OutLink>()
  const slot = (key: string, make: () => OutLink) =>
    out.get(key) ?? (out.set(key, make()), out.get(key)!)
  for (const l of a.links) {
    const r = l.resolution
    const target = r.status === 'ok' ? r.target : undefined
    slot(target ? target.id : `${r.status}:${fold(l.target)}`, () => ({
      ...(target ? { target } : {}),
      text: target ? target.title : l.label?.trim() || l.target,
      status: r.status,
      links: 0,
      names: 0,
    })).links++
  }
  for (const m of a.mentions) {
    if (m.status !== 'tagged') continue
    const target = index.targetOf(m.recordIds[0]!)
    if (target && target.id !== id)
      slot(target.id, () => ({ target, text: target.title, status: 'ok', links: 0, names: 0 }))
        .names++
  }
  return [...out.values()]
}

/** The records named in a scene (by links or tagged names), with the ways each is written. */
export function foundNames(index: ReportSource, id: string): FoundName[] {
  const a = index.analysis(id)
  if (!a) return []
  const found = new Map<string, FoundName>()
  const add = (target: Target, text: string) => {
    const f = found.get(target.id) ?? { target, forms: [], count: 0 }
    found.set(target.id, f)
    f.count++
    const form = f.forms.find((x) => x.text === text)
    if (form) form.count++
    else f.forms.push({ text, count: 1 })
  }
  for (const l of a.links)
    if (l.resolution.status === 'ok' && l.resolution.target.kind === 'record')
      add(l.resolution.target, l.label?.trim() || l.resolution.target.title)
  for (const m of a.mentions) {
    const target = m.status === 'tagged' ? index.targetOf(m.recordIds[0]!) : undefined
    if (target) add(target, m.text)
  }
  return [...found.values()].sort(
    (x, y) => y.count - x.count || x.target.title.localeCompare(y.target.title),
  )
}

/** How a record is written across the workspace: each form and how often, in how many files, and the places still a question. */
export function nameUsage(
  index: ReportSource,
  recordId: string,
): { forms: FoundName['forms']; files: number; questions: number } {
  const forms = new Map<string, number>()
  let files = 0
  let questions = 0
  for (const { id } of index.documents()) {
    if (id === recordId) continue
    const a = index.analysis(id)
    if (!a) continue
    let here = false
    const add = (text: string) => (forms.set(text, (forms.get(text) ?? 0) + 1), (here = true))
    for (const l of a.links)
      if (l.resolution.status === 'ok' && l.resolution.target.id === recordId)
        add(l.label?.trim() || l.resolution.target.title)
    for (const m of a.mentions) {
      if (!m.recordIds.includes(recordId)) continue
      if (m.status === 'tagged') add(m.text)
      else questions++
    }
    if (here) files++
  }
  return {
    forms: [...forms].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
    files,
    questions,
  }
}

/** Names the text leaves a question about, grouped by the word written. */
export function openQuestions(index: ReportSource, id: string): OpenQuestion[] {
  const groups = new Map<string, OpenQuestion>()
  for (const m of index.analysis(id)?.mentions ?? []) {
    if (m.status !== 'suggest') continue
    const key = `${m.text}|${m.recordIds.join(',')}`
    const g = groups.get(key) ?? {
      text: m.text,
      count: 0,
      reason: m.reason!,
      candidates: m.recordIds.flatMap((r) => index.targetOf(r) ?? []),
    }
    g.count++
    groups.set(key, g)
  }
  return [...groups.values()]
}
