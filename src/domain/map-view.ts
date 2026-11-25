// SPDX-License-Identifier: AGPL-3.0-or-later
// The zoom and pan of a map picture inside its frame (ADR-0017). Pixels in, pixels out; no DOM.

export interface Size {
  w: number
  h: number
}
/** The picture is drawn `fit` pixels big, scaled by `k` and moved by x, y (from the frame's top left corner). */
export interface MapView {
  k: number
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

/** The picture as big as fits inside the frame, whole. */
export function fitSize(frame: Size, image: Size): Size {
  if (!image.w || !image.h || !frame.w || !frame.h) return { w: 0, h: 0 }
  const scale = Math.min(frame.w / image.w, frame.h / image.h)
  return { w: image.w * scale, h: image.h * scale }
}

const within = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n))
/** One axis: a picture smaller than the frame is centred, a bigger one cannot leave a gap at an edge. */
const along = (offset: number, frame: number, picture: number) =>
  picture <= frame ? (frame - picture) / 2 : within(offset, frame - picture, 0)

/** The view kept legal: zoom between the limits, the picture never pulled off the frame. */
export function clampView(view: MapView, frame: Size, fit: Size): MapView {
  const k = within(view.k, MIN_ZOOM, MAX_ZOOM)
  return { k, x: along(view.x, frame.w, fit.w * k), y: along(view.y, frame.h, fit.h * k) }
}

/** The whole picture, centred. */
export const fitView = (frame: Size, fit: Size): MapView =>
  clampView({ k: MIN_ZOOM, x: 0, y: 0 }, frame, fit)

/** Zoom to `k`, keeping the point under (px, py) — in the frame's pixels — where it is. */
export function zoomAt(view: MapView, k: number, px: number, py: number, frame: Size, fit: Size) {
  const next = within(k, MIN_ZOOM, MAX_ZOOM)
  const ratio = next / view.k
  return clampView(
    { k: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio },
    frame,
    fit,
  )
}

/** Move the picture by dx, dy pixels. */
export const panBy = (view: MapView, dx: number, dy: number, frame: Size, fit: Size) =>
  clampView({ ...view, x: view.x + dx, y: view.y + dy }, frame, fit)

/** A wheel's turn in pixels: Firefox reports lines (deltaMode 1) and some devices pages (2), not pixels. */
export const wheelPixels = (delta: number, mode: number, pageHeight: number) =>
  mode === 1 ? delta * 16 : mode === 2 ? delta * pageHeight : delta

/** The zoom a mouse wheel (or a trackpad's pinch, which arrives as a wheel with Ctrl) asks for. */
export const wheelFactor = (deltaY: number, pinch: boolean) =>
  Math.exp(-deltaY * (pinch ? 0.01 : 0.002))

/** The point a pointer is at on the picture, as fractions 0..1 of its width and height. */
export function fractionAt(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  const f = (n: number) => within(n, 0, 1)
  return {
    x: f((clientX - rect.left) / (rect.width || 1)),
    y: f((clientY - rect.top) / (rect.height || 1)),
  }
}

/** Whether a point of the screen is on the picture itself, not in the margin beside it. */
export const isOnPicture = (
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) =>
  clientX >= rect.left &&
  clientX <= rect.left + rect.width &&
  clientY >= rect.top &&
  clientY <= rect.top + rect.height

/** How far to move the picture so a point of it (in the frame's pixels) is on screen, with a margin; 0 if it is. */
export function revealShift(point: number, frame: number, margin: number, lead = margin) {
  if (point < lead) return lead - point
  if (point > frame - margin) return frame - margin - point
  return 0
}
