// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pasted HTML with its tables taken apart: a row becomes a paragraph and its cells are told
 * apart by a space. The editor has no table yet, and the cell text would otherwise run together
 * (`NameRoleElenaCourier`).
 */
export function separateTableCells(html: string): string {
  if (!/<t(?:able|r|d|h)\b/i.test(html)) return html
  return html
    .replace(/<\/t[dh]>\s*/gi, ' ')
    .replace(/<tr\b[^>]*>/gi, '<p>')
    .replace(/<\/tr>/gi, '</p>')
    .replace(/<\/?(?:table|thead|tbody|tfoot|colgroup|col|caption|td|th)\b[^>]*>/gi, '')
    .replace(/ +<\/p>/g, '</p>')
}
