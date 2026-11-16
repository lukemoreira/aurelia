// SPDX-License-Identifier: AGPL-3.0-or-later
// A small layered layout for the story map (ADR-0004: "dagre-style", our own). The start scene is
// at the top; every choice that does not go back leads one row or more down; scenes no path
// reaches sit in a band under the rest; a choice to a missing scene ends in a dashed ghost node.
// A choice that crosses rows passes through a narrow gap in each row between, so it never runs
// behind another scene. Deterministic: the same graph gives the same positions, every time.
import type { StoryGraph } from './story-graph'

export const NODE_W = 168
export const NODE_H = 60
const DUMMY_W = 16
const GAP_X = 40
const GAP_Y = 76
const PAD = 32
const MAX_GAPS = 6

export interface LayoutNode {
  /** A scene ID, or `ghost:<choice id>` for the place a broken choice points at. */
  id: string
  x: number
  y: number
  layer: number
  ghost: boolean
}

export interface LayoutEdge {
  /** The choice's ID. */
  id: string
  from: string
  to: string
  label: string
  /** SVG path. */
  d: string
  /** The rows it passes through between its two scenes, as points. */
  via: { x: number; y: number }[]
  /** Where the label sits. */
  lx: number
  ly: number
  broken: boolean
  /** Goes back up, to itself or sideways: a loop. */
  back: boolean
}

export interface Layout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  byId: Map<string, LayoutNode>
  width: number
  height: number
}

interface Link {
  id: string
  from: string
  to: string
  label: string
  broken: boolean
}
type Point = [number, number]
type Cubic = [Point, Point, Point, Point]

const at = ([p0, p1, p2, p3]: Cubic, t: number): Point => {
  const u = 1 - t
  const f = (i: 0 | 1) =>
    u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]
  return [f(0), f(1)]
}
interface Box {
  x: number
  y: number
  w: number
  h: number
}
/** The room a label takes, about: its words at 12px, and a little air. */
const labelBox = (label: string, [x, y]: Point): Box => {
  const w = Math.min(label.length, 26) * 6.4 + 12
  return { x: x - w / 2, y: y - 9, w, h: 18 }
}

/** Boxes and points in a grid of cells, so asking what is near a label does not look at the whole map. */
class Grid<T> {
  private cells = new Map<number, T[]>()
  private readonly size = 48
  private key(cx: number, cy: number) {
    return cx * 100_003 + cy
  }
  /** Put `item` in every cell the box touches. */
  add(item: T, box: Box) {
    for (
      let cx = Math.floor(box.x / this.size);
      cx <= Math.floor((box.x + box.w) / this.size);
      cx++
    )
      for (
        let cy = Math.floor(box.y / this.size);
        cy <= Math.floor((box.y + box.h) / this.size);
        cy++
      ) {
        const k = this.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(item)
        else this.cells.set(k, [item])
      }
  }
  /** What is in the cells a box touches (an item may come up more than once). */
  near(box: Box): T[] {
    const out: T[] = []
    for (
      let cx = Math.floor(box.x / this.size);
      cx <= Math.floor((box.x + box.w) / this.size);
      cx++
    )
      for (
        let cy = Math.floor(box.y / this.size);
        cy <= Math.floor((box.y + box.h) / this.size);
        cy++
      )
        out.push(...(this.cells.get(this.key(cx, cy)) ?? []))
    return out
  }
}
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = ([x, y]: Point, b: Box) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

/** Where along each piece of a path a label may sit: first near its start (the scene the choice is made in), then outwards. */
const ALONG = [0.3, 0.4, 0.2, 0.5, 0.6, 0.15, 0.7, 0.8]

export function layoutStory(g: StoryGraph): Layout {
  const ghosts = g.edges.filter((e) => e.broken)
  const ids = [...g.order, ...ghosts.map((e) => `ghost:${e.id}`)]
  const links: Link[] = g.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.broken ? `ghost:${e.id}` : e.target,
    label: e.label,
    broken: !!e.broken,
  }))
  const out = new Map<string, Link[]>()
  const into = new Map<string, Link[]>()
  for (const l of links) {
    out.set(l.from, [...(out.get(l.from) ?? []), l])
    into.set(l.to, [...(into.get(l.to) ?? []), l])
  }

  // Depth-first from the start, then from what has no way in, then from the rest: choices into a
  // scene still being walked go back (they are loops); the others form an acyclic graph to layer.
  const roots = [
    ...(g.start ? [g.start] : []),
    ...g.order.filter((id) => id !== g.start && !(into.get(id)?.length ?? 0)),
    ...g.order,
  ]
  const state = new Map<string, 1 | 2>()
  const back = new Set<string>()
  const finished: string[] = []
  const discovered = new Map<string, number>()
  for (const root of roots) {
    if (state.has(root)) continue
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }]
    state.set(root, 1)
    discovered.set(root, discovered.size)
    while (stack.length) {
      const top = stack.at(-1)!
      const link = out.get(top.id)?.[top.next++]
      if (!link) {
        state.set(top.id, 2)
        finished.push(top.id)
        stack.pop()
      } else if (state.get(link.to) === 1) back.add(link.id)
      else if (!state.has(link.to)) {
        state.set(link.to, 1)
        discovered.set(link.to, discovered.size)
        stack.push({ id: link.to, next: 0 })
      }
    }
  }

  // Longest path from the top. A choice from a scene nobody can reach into one that is reached does
  // not push that one down: the unreachable band must not move the story.
  const owner = new Map(ghosts.map((e) => [`ghost:${e.id}`, e.from]))
  const live = (id: string) => g.reachable.has(id) || g.reachable.has(owner.get(id) ?? '')
  const layer = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const id of [...finished].reverse())
    for (const l of out.get(id) ?? []) {
      if (back.has(l.id) || (live(l.to) && !live(l.from))) continue
      layer.set(l.to, Math.max(layer.get(l.to)!, layer.get(id)! + 1))
    }
  const below = Math.max(-1, ...ids.filter(live).map((id) => layer.get(id)!)) + 1
  for (const id of ids) if (!live(id)) layer.set(id, layer.get(id)! + below)

  // A choice that crosses rows gets a gap in each row between ("dummy" nodes): the rows are ordered
  // with them in, so what is in the way moves aside. A choice that goes back up is placed the same
  // way, between the same two rows, and drawn from the lower scene up into the higher.
  const up = new Map<string, string[]>()
  const down = new Map<string, string[]>()
  /** The scenes and gaps a choice runs through, from the higher row to the lower. */
  const chains = new Map<string, { ids: string[]; up: boolean }>()
  const dummies = new Set<string>()
  const joinUp = (a: string, b: string) => {
    down.set(a, (down.get(a) ?? []).concat(b))
    up.set(b, (up.get(b) ?? []).concat(a))
  }
  for (const l of links) {
    const [from, to] = [layer.get(l.from)!, layer.get(l.to)!]
    if (l.from === l.to || from === to) continue
    const goesUp = to < from
    const [top, bottom] = goesUp ? [l.to, l.from] : [l.from, l.to]
    const ids = [top]
    const gaps = Math.abs(from - to) - 1
    // A choice that crosses very many rows is drawn straight across: a gap in each would be most of the map.
    for (let r = Math.min(from, to) + 1; gaps <= MAX_GAPS && r < Math.max(from, to); r++) {
      const d = `dummy:${l.id}:${r}`
      dummies.add(d)
      layer.set(d, r)
      discovered.set(d, discovered.get(l.from)! + 0.5)
      ids.push(d)
    }
    ids.push(bottom)
    chains.set(l.id, { ids, up: goesUp })
    for (let i = 0; i + 1 < ids.length; i++) joinUp(ids[i]!, ids[i + 1]!)
  }

  // Order inside each row: first by discovery, then a few sweeps that put a scene under the middle
  // of what leads to it (and over the middle of what it leads to).
  const rows: string[][] = []
  for (const id of [...layer.keys()].sort((a, b) => discovered.get(a)! - discovered.get(b)!))
    (rows[layer.get(id)!] ??= []).push(id)
  for (let r = 0; r < rows.length; r++) rows[r] ??= []
  const place = new Map<string, number>()
  rows.forEach((row) => row.forEach((id, i) => place.set(id, i)))
  const sweep = (r: number, near: Map<string, string[]>) => {
    const key = new Map(
      rows[r]!.map((id, i) => {
        const slots = (near.get(id) ?? []).map((n) => place.get(n)!)
        return [id, slots.length ? slots.reduce((a, b) => a + b, 0) / slots.length : i] as const
      }),
    )
    rows[r] = [...rows[r]!].sort(
      (a, b) => key.get(a)! - key.get(b)! || place.get(a)! - place.get(b)!,
    )
    rows[r]!.forEach((id, i) => place.set(id, i))
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r < rows.length; r++) sweep(r, up)
    for (let r = rows.length - 2; r >= 0; r--) sweep(r, down)
  }

  const width = (id: string) => (dummies.has(id) ? DUMMY_W : NODE_W)
  const gap = (a: string, b: string) => (dummies.has(a) || dummies.has(b) ? GAP_X / 2 : GAP_X)
  const spans = rows.map((row) =>
    row.reduce((n, id, i) => n + width(id) + (i ? gap(row[i - 1]!, id) : 0), 0),
  )
  const inner = Math.max(NODE_W, ...spans)
  const spot = new Map<string, { x: number; y: number; layer: number }>()
  rows.forEach((row, r) => {
    let x = PAD + (inner - spans[r]!) / 2
    row.forEach((id, i) => {
      if (i) x += gap(row[i - 1]!, id)
      spot.set(id, { x, y: PAD + r * (NODE_H + GAP_Y), layer: r })
      x += width(id)
    })
  })
  const nodes: LayoutNode[] = []
  const byId = new Map<string, LayoutNode>()
  for (const [id, s] of spot) {
    if (dummies.has(id)) continue
    const node = { id, ...s, ghost: id.startsWith('ghost:') }
    nodes.push(node)
    byId.set(id, node)
  }

  const right = PAD + inner
  const built = links.map((l) => {
    const a = byId.get(l.from)!
    const b = byId.get(l.to)!
    let segments: Cubic[]
    let via: { x: number; y: number }[] = []
    const chain = chains.get(l.id)
    if (chain) {
      // Through the gaps: every bend has a vertical tangent, so the joins are smooth. A choice going
      // back up leaves the lower scene's top and enters the higher one's bottom, a little to the
      // right of centre, so it does not lie on a choice going the other way between the same two.
      const shift = chain.up ? 24 : 0
      const points: Point[] = chain.ids.map((id, i) => {
        const s = spot.get(id)!
        return i === 0
          ? [s.x + NODE_W / 2 + shift, s.y + NODE_H]
          : i === chain.ids.length - 1
            ? [s.x + NODE_W / 2 + shift, s.y]
            : [s.x + DUMMY_W / 2, s.y + NODE_H / 2]
      })
      if (chain.up) points.reverse()
      via = points.slice(1, -1).map(([x, y]) => ({ x, y }))
      segments = points.slice(0, -1).map((p, i) => {
        const q = points[i + 1]!
        const dy = (q[1] - p[1]) / 2
        return [p, [p[0], p[1] + dy], [q[0], q[1] - dy], q]
      })
    } else if (l.from === l.to) {
      const [x, y] = [a.x + NODE_W, a.y + NODE_H / 2]
      segments = [
        [
          [x, y - 8],
          [x + 48, y - 30],
          [x + 48, y + 30],
          [x, y + 8],
        ],
      ]
    } else {
      // Two scenes in one row (a choice between them, with nothing between the rows): an arc over the top.
      const [sx, tx, y] = [a.x + NODE_W / 2, b.x + NODE_W / 2, a.y]
      segments = [
        [
          [sx, y],
          [sx, y - 44],
          [tx, y - 44],
          [tx, y],
        ],
      ]
    }
    const d = segments
      .map(
        ([p0, p1, p2, p3], i) =>
          `${i ? '' : `M ${p0[0]} ${p0[1]} `}C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`,
      )
      .join(' ')
    return { l, d, via, segments, back: !!chain?.up || l.from === l.to || !chain }
  })

  // What a label must keep clear of: the scenes, the other labels, and every other choice's line.
  const scenes = new Grid<Box>()
  for (const n of nodes) {
    const box = { x: n.x, y: n.y, w: NODE_W, h: NODE_H }
    scenes.add(box, box)
  }
  const lines = new Grid<{ edge: number; at: Point }>()
  built.forEach((e, edge) => {
    for (const seg of e.segments)
      for (let k = 0; k <= 10; k++) {
        const p = at(seg, k / 10)
        lines.add({ edge, at: p }, { x: p[0], y: p[1], w: 0, h: 0 })
      }
  })
  const labels = new Grid<Box>()
  const edges: LayoutEdge[] = built.map((e, edge) => {
    // Candidates along the path, from its start; the first that touches nothing wins, else the one
    // that touches least.
    // Not off the left edge of the map: a gap at the far left would cut the label short.
    const least = labelBox(e.l.label, [0, 0]).w / 2 + 8
    const spots: Point[] = e.segments.flatMap((seg) =>
      ALONG.map((t): Point => {
        const [x, y] = at(seg, t)
        return [Math.max(x, least), y]
      }),
    )
    let best: { at: Point; cost: number } | undefined
    /** Try a place; `away` is how far it stands from the line, which counts against it. */
    const tryAt = (p: Point, away = 0) => {
      const box = labelBox(e.l.label, p)
      const cost =
        10 * scenes.near(box).filter((b) => overlap(box, b)).length +
        10 * labels.near(box).filter((b) => overlap(box, b)).length +
        lines.near(box).filter((x) => x.edge !== edge && inside(x.at, box)).length +
        away / 16
      if (!best || cost < best.cost) best = { at: p, cost }
      return cost === 0
    }
    // On the line first; if every place on it is taken, beside it, the nearest free place wins.
    if (!spots.some((p) => tryAt(p)))
      for (const [x, y] of spots)
        for (const dx of [-48, 48, -96, 96, -150, 150])
          tryAt([Math.max(x + dx, least), y], Math.abs(dx))
    const [lx, ly] = best!.at
    const box = labelBox(e.l.label, [lx, ly])
    labels.add(box, box)
    const { l } = e
    return {
      id: l.id,
      from: l.from,
      to: l.to,
      label: l.label,
      broken: l.broken,
      d: e.d,
      via: e.via,
      lx,
      ly,
      back: e.back,
    }
  })
  return {
    nodes,
    edges,
    byId,
    width: right + PAD + 24,
    height: PAD * 2 + rows.length * NODE_H + Math.max(0, rows.length - 1) * GAP_Y,
  }
}

/** The scene to move to from `id` when an arrow key is pressed: the nearest one that way. */
export function nodeInDirection(
  layout: Layout,
  id: string,
  dir: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const from = layout.byId.get(id)
  if (!from) return undefined
  let best: { id: string; cost: number } | undefined
  for (const n of layout.nodes) {
    if (n.ghost || n.id === id) continue
    const [dx, dy] = [n.x - from.x, n.y - from.y]
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
    if (along <= 0) continue
    const cost = along + across * 2
    if (!best || cost < best.cost) best = { id: n.id, cost }
  }
  return best?.id
}
