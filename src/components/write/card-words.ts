// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CardView } from '@/editor/link-env'

/** The question or the name at the top of a card. */
export function cardHeading(card: CardView): string {
  const { kind, text, targets, status } = card
  if (kind === 'ask')
    return targets.length === 1 ? `Is this ${targets[0]!.title}?` : `Which one is “${text}”?`
  if (status === 'missing') return `Nothing is called “${text}”`
  if (status === 'ambiguous') return `More than one thing is called “${text}”`
  return targets[0]?.title ?? text
}

/** Why Aurelia is asking, in plain words. */
export function cardWhy(card: CardView): string {
  const { reason, text } = card
  if (reason === 'shared') return `More than one thing is called “${text}”.`
  if (reason === 'ask') return `You asked to be asked about “${text}”.`
  if (reason === 'sentence-start')
    return `“${text}” is also an ordinary word at the start of a sentence, so Aurelia asks.`
  return ''
}

/** What a screen reader hears when a card opens: it never takes focus, so this says it is there. */
export function cardAnnouncement(card: CardView | null, keys: { answer: string; open: string }) {
  if (!card) return ''
  const first = card.targets[0]
  if (card.kind === 'ask')
    return `${cardHeading(card)} ${cardWhy(card)}${card.writable ? ` Press ${keys.answer} to answer.` : ''}`
  if (first && card.targets.length === 1)
    return `${first.title}, ${first.label.toLowerCase()}. ${first.summary ?? ''} Press ${keys.open} to open it.`.trim()
  return cardHeading(card)
}
