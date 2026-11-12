// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared look of every text-like control: 32px with a mouse, 44px on touch, `field` border (3:1).
export const fieldControlClass =
  'h-8 w-full rounded-control border border-field bg-surface px-2.5 text-[13px] text-ink ' +
  'placeholder:text-ink-3 disabled:cursor-not-allowed disabled:border-line-2 disabled:bg-raised ' +
  'disabled:text-ink-3 aria-[invalid=true]:border-danger pointer-coarse:h-11'
