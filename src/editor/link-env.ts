// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SuggestReason } from '@/index/names'
import type { Analysis, Resolution, Target } from '@/index/workspace-index'

/** A record or scene a `[[` can point at, as the picker lists it. */
export type PickItem = Target & { byId: boolean }

/** What the card on a link or a name says. The words and the buttons are the screen's; this is the data. */
export interface CardView {
  /** Where the thing is on screen, for the card to sit beside it. */
  rect: DOMRect
  /** A link, a name found in the text, or a name the app is not sure about. */
  kind: 'link' | 'name' | 'ask'
  /** The words in the text. */
  text: string
  /** What it points at: one thing, or (for a question) the things it might be. Empty: points nowhere. */
  targets: Target[]
  status: Resolution['status']
  /** Why a name is a question (kind `ask`). */
  reason?: SuggestReason
  /** The text can be changed: the answers are offered. */
  writable: boolean
  open: (target: Target) => void
  /** Records and scenes by name, for "Someone or somewhere else…". */
  pick: (query: string) => PickItem[]
  /** Give the keyboard back to the text this card is about. */
  returnFocus: () => void
  /** "Yes, it is this one": turn that place into a link. */
  accept: (target: Target) => void
  /** "Not a name": the place is not asked about again. */
  notAName: () => void
}

/** The picker that opens on `[[`. */
export interface PickerView {
  /** Where the caret is now: asked again when the page scrolls. */
  rect: () => DOMRect
  query: string
  items: PickItem[]
  active: number
  choose: (item: PickItem) => void
}

/**
 * What the editor needs from the app to know links and names. The editor stays free of the
 * stores: a screen (or a test) hands these in.
 */
export interface LinkEnv {
  /** Links and names in the text on screen; null while nothing is known (no workspace). */
  analyse(text: string): Analysis | null
  /** Records and scenes a `[[` can point at, best match first. */
  pick(query: string): PickItem[]
  writable(): boolean
  /** What an ID names (a scene or a record), for the cards. */
  target(id: string): Target | undefined
  /** Open the scene or the record sheet. */
  open(target: Target): void
  /** The author said this place is not a name. */
  notAName(key: string): void
  card: {
    show(card: CardView): void
    /** The pointer or the caret left. The card stays a moment so the pointer can reach it. */
    leave(): void
    /** Close it now; true when one was open. */
    close(): boolean
    /** Move the keyboard into an open card; false when none is open. */
    focus(): boolean
  }
  picker: { show(view: PickerView): void; hide(): void }
}
