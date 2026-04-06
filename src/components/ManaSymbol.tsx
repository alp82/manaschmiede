import { useT } from '../lib/i18n'

const MANA_COLORS = {
  W: { labelKey: 'color.white', symbol: 'W', glow: 'oklch(0.92 0.04 90 / 0.4)' },
  U: { labelKey: 'color.blue', symbol: 'U', glow: 'oklch(0.55 0.18 250 / 0.4)' },
  B: { labelKey: 'color.black', symbol: 'B', glow: 'oklch(0.30 0.02 285 / 0.5)' },
  R: { labelKey: 'color.red', symbol: 'R', glow: 'oklch(0.58 0.22 25 / 0.4)' },
  G: { labelKey: 'color.green', symbol: 'G', glow: 'oklch(0.60 0.18 145 / 0.4)' },
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

const sizes = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
}

export function ManaSymbol({ color, size = 'md', selected, recommended, onClick }: ManaSymbolProps) {
  const t = useT()
  const label = t(MANA_COLORS[color].labelKey)

  const glowColor = MANA_COLORS[color].glow

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`
        ${sizes[size]}
        inline-flex items-center justify-center rounded-full
        transition-all duration-150
        ${selected ? 'ring-2 ring-white scale-125' : recommended ? 'opacity-80 scale-105' : 'opacity-50 hover:opacity-80'}
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
      `}
      style={selected ? {
        filter: `drop-shadow(0 0 10px ${glowColor})`,
      } : recommended ? {
        filter: `drop-shadow(0 0 8px ${glowColor})`,
        animation: 'glow-mana 2s ease-in-out infinite',
      } : undefined}
    >
      <img
        src={manaSymbolUrl(color)}
        alt={label}
        className="h-full w-full"
        draggable={false}
      />
    </button>
  )
}

/** Get the translated label for a mana color (for use outside ManaSymbol) */
export function useManaColorLabel(color: ManaColor): string {
  const t = useT()
  return t(MANA_COLORS[color].labelKey)
}

export { MANA_COLORS, manaSymbolUrl }
