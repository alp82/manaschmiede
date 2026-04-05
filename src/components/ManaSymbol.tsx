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
  onClick?: () => void
}

const sizes = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
}

export function ManaSymbol({ color, size = 'md', selected, onClick }: ManaSymbolProps) {
  const t = useT()
  const label = t(MANA_COLORS[color].labelKey)

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`
        ${sizes[size]}
        inline-flex items-center justify-center rounded-full
        transition-all duration-150
        ${selected ? 'ring-2 ring-white scale-110' : 'opacity-50 hover:opacity-80'}
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
      `}
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
