// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampView,
  fitSize,
  fitView,
  fractionAt,
  isOnPicture,
  revealShift,
  wheelPixels,
  panBy,
  wheelFactor,
  zoomAt,
} from './map-view'

const frame = { w: 600, h: 400 }
const fit = fitSize(frame, { w: 1200, h: 1200 }) // 400 × 400, with a gap either side

describe('the zoom and pan of a map picture', () => {
  it('fits the whole picture, centred, whatever its shape', () => {
    expect(fit).toEqual({ w: 400, h: 400 })
    expect(fitSize(frame, { w: 3000, h: 1000 })).toEqual({ w: 600, h: 200 })
    expect(fitSize(frame, { w: 0, h: 0 })).toEqual({ w: 0, h: 0 })
    expect(fitView(frame, fit)).toEqual({ k: 1, x: 100, y: 0 })
  })

  it('zooms about a point and keeps the point where it was', () => {
    const v = zoomAt(fitView(frame, fit), 2, 300, 200, frame, fit)
    expect(v.k).toBe(2)
    // The middle of the picture was under the point and still is.
    expect(v.x + 200 * v.k).toBeCloseTo(300)
    expect(v.y + 200 * v.k).toBeCloseTo(200)
  })

  it('stays between the zoom limits', () => {
    expect(zoomAt(fitView(frame, fit), 100, 0, 0, frame, fit).k).toBe(MAX_ZOOM)
    expect(zoomAt(fitView(frame, fit), 0.1, 0, 0, frame, fit).k).toBe(MIN_ZOOM)
  })

  it('never leaves a gap at an edge once the picture is bigger than the frame', () => {
    const big = zoomAt(fitView(frame, fit), 4, 300, 200, frame, fit) // 1600 × 1600
    const far = panBy(big, 5000, 5000, frame, fit)
    expect(far.x).toBe(0)
    expect(far.y).toBe(0)
    const other = panBy(big, -9000, -9000, frame, fit)
    expect(other.x).toBe(600 - 1600)
    expect(other.y).toBe(400 - 1600)
  })

  it('keeps a picture that is smaller than the frame in the middle', () => {
    expect(clampView({ k: 1, x: 300, y: -50 }, frame, fit)).toEqual({ k: 1, x: 100, y: 0 })
  })

  it('turns a wheel turn into a zoom factor, in and out, and a pinch faster', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, false)).toBeLessThan(1)
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false))
  })

  it('says where on the picture a pointer is, never outside it', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(fractionAt(rect, 300, 150)).toEqual({ x: 0.5, y: 0.5 })
    expect(fractionAt(rect, 0, 900)).toEqual({ x: 0, y: 1 })
  })

  it('knows a point in the margin beside the picture from one on it', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(isOnPicture(rect, 300, 150)).toBe(true)
    expect(isOnPicture(rect, 90, 150)).toBe(false)
    expect(isOnPicture(rect, 300, 260)).toBe(false)
  })

  it('moves the picture just enough to bring a pin into view, and not at all when it is there', () => {
    expect(revealShift(300, 600, 24)).toBe(0)
    expect(revealShift(-500, 600, 24)).toBe(524)
    expect(revealShift(900, 600, 24)).toBe(-324)
    expect(revealShift(10, 400, 24, 48)).toBe(38) // a pin's body is above its tip: more room at the top
  })

  it('reads a wheel counted in lines or pages (Firefox) as pixels', () => {
    expect(wheelPixels(-3, 0, 400)).toBe(-3)
    expect(wheelPixels(-3, 1, 400)).toBe(-48)
    expect(wheelPixels(1, 2, 400)).toBe(400)
  })
})
