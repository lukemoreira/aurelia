// SPDX-License-Identifier: AGPL-3.0-or-later
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export const buttonBase =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap ' +
  'rounded-control text-[13px] transition-colors disabled:cursor-not-allowed ' +
  'disabled:bg-raised disabled:text-ink-3 disabled:border-transparent'

export const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-gold font-semibold text-on-gold hover:brightness-95',
  secondary: 'border border-line-2 bg-surface font-medium text-ink hover:bg-raised',
  quiet: 'bg-transparent font-medium text-gold-ink hover:bg-gold-soft',
  danger: 'bg-danger font-semibold text-on-accent hover:brightness-95',
}

export const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 pointer-coarse:h-11',
  md: 'h-8 px-3.5 pointer-coarse:h-11',
  lg: 'h-11 px-5 text-sm',
}

export const iconSizeClass: Record<ButtonSize, string> = {
  sm: 'size-7 pointer-coarse:size-11',
  md: 'size-8 pointer-coarse:size-11',
  lg: 'size-11',
}
