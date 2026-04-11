import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'

const MANA_COLORS = {
  W: { labelKey: 'color.white', symbol: 'W' },
  U: { labelKey: 'color.blue', symbol: 'U' },
  B: { labelKey: 'color.black', symbol: 'B' },
  R: { labelKey: 'color.red', symbol: 'R' },
  G: { labelKey: 'color.green', symbol: 'G' },
} as const

export type ManaColor = keyof typeof MANA_COLORS

function manaSymbolUrl(color: ManaColor): string {
  return `https://svgs.scryfall.io/card-symbols/${color}.svg`
}

interface ManaSymbolProps {
  color: ManaColor
  size?: 'sm' | 'md' | 'lg'
  selected?: boolean
  recommended?: boolean
  onClick?: () => void
}

/**
 * Mana symbols are naturally circular (Scryfall's SVGs) so the ring around
 * them is circular too — this does NOT violate Specimen's no-rounding rule,
 * which is about UI chrome. Mana is iconographic.
 */
const sizes = {
  sm: 'h-6 w-6',      // 24px — inline / chips
  md: 'h-8 w-8',      // 32px — stepper tooltip, default
  lg: 'h-14 w-14',    // 56px — hero color picker
}

export function ManaSymbol({ color, size = 'md', selected, recommended, onClick }: ManaSymbolProps) {
  const t = useT()
  const label = t(MANA_COLORS[color].labelKey)

  const classes = cn(
    'relative inline-flex items-center justify-center rounded-full',
    'transition-[opacity,box-shadow] duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
    sizes[size],
    selected
      ? 'opacity-100 ring-2 ring-cream-100 ring-offset-2 ring-offset-ash-900'
      : recommended
        ? 'opacity-80'
        : 'opacity-50',
    onClick && 'cursor-pointer',
    onClick && !selected && 'hover:opacity-100',
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={label} className={classes}>
        <img
          src={manaSymbolUrl(color)}
          alt={label}
          className="h-full w-full"
          draggable={false}
        />
      </button>
    )
  }

  return (
    <span title={label} className={classes} role="img" aria-label={label}>
      <img
        src={manaSymbolUrl(color)}
        alt=""
        className="h-full w-full"
        draggable={false}
        aria-hidden="true"
      />
    </span>
  )
}

/** Get the translated label for a mana color (for use outside ManaSymbol) */
export function useManaColorLabel(color: ManaColor): string {
  const t = useT()
  return t(MANA_COLORS[color].labelKey)
}

export { MANA_COLORS, manaSymbolUrl }
