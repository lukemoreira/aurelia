// SPDX-License-Identifier: AGPL-3.0-or-later

/** Lower case, no accents, no apostrophes, single spaces: "Warden’s  Price" is found by "wardens price". */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’‘]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * Case- and accent-insensitive "contains", with titles that start with the query first.
 * Equal ranks keep their original order.
 */
export function rankByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  const q = fold(query)
  if (!q) return []
  const ranked: { item: T; rank: number; at: number }[] = []
  items.forEach((item, at) => {
    const i = fold(item.title).indexOf(q)
    if (i >= 0) ranked.push({ item, rank: i === 0 ? 0 : 1, at })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map((r) => r.item)
}
