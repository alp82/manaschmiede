/** Renders a mana cost string like "{1}{W/B}{W/B}" as Scryfall SVG icons */
export function ManaCost({ cost, size = 'md' }: { cost: string; size?: 'sm' | 'md' | 'lg' }) {
  const symbols = cost.match(/\{([^}]+)\}/g)
  if (!symbols) return <span>{cost}</span>

  const sizes = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-6 w-6' }

  return (
    <span className="inline-flex items-center gap-0.5">
      {symbols.map((sym, i) => {
        const code = sym.slice(1, -1) // strip { }
        // Scryfall SVG URL uses the symbol code with / encoded
        const urlCode = code.replace('/', '%2F')
        return (
          <img
            key={i}
            src={`https://svgs.scryfall.io/card-symbols/${urlCode}.svg`}
            alt={sym}
            className={sizes[size]}
            draggable={false}
          />
        )
      })}
    </span>
  )
}
