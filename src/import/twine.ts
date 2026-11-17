// SPDX-License-Identifier: AGPL-3.0-or-later
// A Twine story as a plan (ADR-0014, ADR-0004): Twee 3 text, or the HTML Twine publishes. Passages become the
// scenes of a branching book and links become choices. The story format's macros and variables are
// kept as the text they are and named in the report: Aurelia has no conditions yet (ADR-0004).
// Nothing is run and no markup is ever inserted into a page: the HTML is read with `DOMParser`, as data.
import { emptyReport, report, titleOf, type ImportPlan, type PlanScene } from './plan'

export interface Passage {
  name: string
  tags: string[]
  text: string
  pid?: string
}

export interface Story {
  title?: string
  /** The passage the story starts at, by name. */
  start?: string
  format?: string
  passages: Passage[]
}

/** Passages that hold a story format's settings, scripts or styles, not the story. */
const SETTINGS_NAMES = new Set([
  'StoryAuthor',
  'StoryBanner',
  'StoryCaption',
  'StoryDisplayTitle',
  'StoryFooter',
  'StoryHeader',
  'StoryInit',
  'StoryInterface',
  'StoryMenu',
  'StorySubtitle',
  'PassageDone',
  'PassageFooter',
  'PassageHeader',
  'PassageReady',
  'UserScript',
  'UserStylesheet',
])
const CODE_TAGS = new Set(['script', 'stylesheet', 'widget', 'init', 'startup'])

export const isTwineHtml = (text: string) => /<tw-storydata[\s>]/i.test(text)

/** Twee 3: `:: Name [tags] {"position": "…"}` on a line of its own, and the passage's text below it. */
export function parseTwee(text: string): Story {
  const story: Story = { passages: [] }
  let current: Passage | undefined
  let lines: string[] = []
  const finish = () => {
    if (!current) return
    const body = lines.join('\n').replace(/^\n+|\s+$/g, '')
    if (current.name === 'StoryTitle') story.title = body.trim()
    else if (current.name === 'StoryData') {
      try {
        const data = JSON.parse(body) as { start?: unknown; format?: unknown }
        if (typeof data.start === 'string') story.start = data.start
        if (typeof data.format === 'string') story.format = data.format
      } catch {
        // A StoryData that is not JSON says nothing: the start is found another way.
      }
    } else story.passages.push({ ...current, text: body })
  }
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (line.startsWith('::')) {
      finish()
      current = header(line.slice(2))
      lines = []
    } else if (current) lines.push(line)
  }
  finish()
  return story
}

/** `Name [tag tag] {"meta": 1}`: the name ends at the first `[` or `{` that is not escaped with a backslash. */
function header(rest: string): Passage {
  let name = ''
  let i = 0
  while (i < rest.length && rest[i] !== '[' && rest[i] !== '{') {
    if (rest[i] === '\\' && i + 1 < rest.length) i++
    name += rest[i]
    i++
  }
  let tags: string[] = []
  if (rest[i] === '[') {
    const end = rest.indexOf(']', i)
    if (end > 0)
      tags = rest
        .slice(i + 1, end)
        .split(/\s+/)
        .filter(Boolean)
  }
  return { name: name.trim(), tags, text: '' }
}

/** The HTML Twine publishes: `<tw-storydata>` with a `<tw-passagedata>` for each passage. The first story of an archive. */
export function parseTwineHtml(html: string): { story: Story; others: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const stories = [...doc.querySelectorAll('tw-storydata')]
  const first = stories[0]
  if (!first) return { story: { passages: [] }, others: [] }
  const passages = [...first.querySelectorAll('tw-passagedata')].map((p) => ({
    name: p.getAttribute('name') ?? '',
    tags: (p.getAttribute('tags') ?? '').split(/\s+/).filter(Boolean),
    // `textContent`: the text as the author wrote it, whatever it holds is only ever text.
    text: (p.textContent ?? '').replace(/\r\n?/g, '\n'),
    pid: p.getAttribute('pid') ?? '',
  }))
  const startPid = first.getAttribute('startnode')
  const start = passages.find((p) => p.pid === startPid)?.name
  return {
    story: {
      title: first.getAttribute('name') ?? undefined,
      ...(start ? { start } : {}),
      format: first.getAttribute('format') ?? undefined,
      passages,
    },
    others: stories.slice(1).map((s) => s.getAttribute('name') || 'Untitled story'),
  }
}

interface Link {
  start: number
  end: number
  label: string
  target: string
  /** The link also sets a variable (`[[go|there][$x to 1]]`). */
  setter: boolean
}

const LINK = /\[\[((?:[^\]\n]|\](?!\]))+)\]\]/g

/**
 * `[[label->target]]`, `[[target<-label]]`, `[[label|target]]` and `[[target]]`, the way Twine reads them: a `|`
 * first, then the rightmost `->`, then the leftmost `<-`. A setter (`[[go|there][$x to 1]]`) is not part of the link.
 */
export function parseLinks(text: string): Link[] {
  const out: Link[] = []
  for (const m of text.matchAll(LINK)) {
    const inner = m[1]!.replace(/\]\[[\s\S]*$/, '')
    let label = inner
    let target = inner
    const bar = inner.indexOf('|')
    const right = inner.lastIndexOf('->')
    const left = inner.indexOf('<-')
    if (bar >= 0) [label, target] = [inner.slice(0, bar), inner.slice(bar + 1)]
    else if (right >= 0) [label, target] = [inner.slice(0, right), inner.slice(right + 2)]
    else if (left >= 0) [target, label] = [inner.slice(0, left), inner.slice(left + 2)]
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      label: label.trim(),
      target: target.trim(),
      setter: inner !== m[1],
    })
  }
  return out
}

/** Names of the macros and variables a passage uses: `(set:)`, `<<if>>`, `$gold`. */
function macrosIn(text: string, harlowe: boolean): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/<<\s*\/?([A-Za-z][\w-]*)/g)) found.add(`<<${m[1]}>>`)
  if (harlowe) for (const m of text.matchAll(/\(([a-z][\w-]*):/g)) found.add(`(${m[1]}:)`)
  for (const m of text.matchAll(/\$[A-Za-z_]\w*|(?<!\w)_[A-Za-z]\w*/g)) found.add(m[0])
  return [...found]
}

/**
 * The passage's text for a scene: a line made only of links is the choices (they are kept as choices), a link inside
 * a sentence is its label, a link whose passage is not in the story stays as its label too, so no words are lost.
 */
function sceneText(text: string, links: Link[], known: (target: string) => boolean): string {
  const kept: string[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const here = links.filter((l) => l.start >= offset && l.end <= offset + line.length)
    const rest = line.replace(LINK, '').replace(/[\s*\-•>]+/g, '')
    const only = here.length > 0 && !rest && here.every((l) => known(l.target))
    if (!only) {
      let out = ''
      let at = 0
      for (const l of here) {
        out += line.slice(at, l.start - offset) + (l.label || l.target)
        at = l.end - offset
      }
      kept.push(out + line.slice(at))
    }
    offset += line.length + 1
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\s+$/g, '')
}

/** The plan for a story. `fallback` names the book when the story has no title. */
export function twinePlan(story: Story, fallback: string, others: string[] = []): ImportPlan {
  const notes = emptyReport()
  const harlowe = !story.format || /^harlowe/i.test(story.format)
  const scenes: { passage: Passage; key: string }[] = []
  for (const passage of story.passages) {
    const settings = SETTINGS_NAMES.has(passage.name) || passage.tags.some((t) => CODE_TAGS.has(t))
    if (settings)
      report(
        notes.unread,
        'A passage that holds the story format’s code or settings is not a scene, so it was not imported',
        passage.name || '(no name)',
      )
    else scenes.push({ passage, key: `p${scenes.length + 1}` })
  }
  for (const name of others)
    report(notes.unread, 'Only the first story of a Twine archive is imported', name)

  const byName = new Map<string, string>()
  for (const s of scenes) if (!byName.has(s.passage.name)) byName.set(s.passage.name, s.key)
  const resolve = (target: string) => byName.get(target) ?? byName.get(target.trim())

  const tags = new Set<string>()
  const planScenes: PlanScene[] = scenes.map(({ passage, key }) => {
    const links = parseLinks(passage.text)
    const choices: PlanScene['choices'] = []
    for (const link of links) {
      const target = resolve(link.target)
      if (target) choices.push({ label: link.label || link.target, target })
      else
        report(
          notes.notes,
          'A link leads to a passage that is not in the story, so it is only words here, not a choice',
          `${passage.name}: ${link.target}`,
        )
    }
    if (links.some((l) => l.setter))
      report(
        notes.notes,
        'A link sets a variable; the setting is dropped (the variable stays named in the text)',
        passage.name,
      )
    for (const t of passage.tags) tags.add(t)
    const used = macrosIn(passage.text, harlowe)
    if (used.length)
      report(
        notes.notes,
        `Macros and variables stay as text, because Aurelia has no conditions or variables yet: ${used.join(' ')}`,
        passage.name,
      )
    const body = sceneText(passage.text, links, (t) => !!resolve(t))
    return {
      key,
      title: titleOf(passage.name, 'Untitled passage'),
      body: body ? `${body}\n` : '',
      choices,
      ...(!choices.length && !used.length ? { ending: true } : {}),
    }
  })
  if (tags.size) report(notes.notes, `Passage tags are not kept: ${[...tags].join(', ')}`)
  const ended = planScenes.filter((s) => s.ending).length
  if (ended) report(notes.notes, 'A passage with no links is marked as an ending')

  const startKey = (story.start && byName.get(story.start)) || byName.get('Start') || scenes[0]?.key
  return {
    source: 'twine',
    title: titleOf(story.title ?? '', titleOf(fallback, 'Imported story')),
    mode: 'branching',
    chapters: planScenes.length ? [{ title: 'Passages', scenes: planScenes }] : [],
    ...(startKey ? { start: startKey } : {}),
    report: notes,
  }
}
