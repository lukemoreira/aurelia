// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a card or a list sits beside the thing it is about (fixed, in the window's own
 * coordinates): below it, or above when there is no room below, and never past either side.
 */
export function placeNear(rect: DOMRect, width: number, height: number) {
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  return rect.bottom + height > window.innerHeight
    ? { left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px` }
    : { left: `${left}px`, top: `${rect.bottom + 6}px` }
}
