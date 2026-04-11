import { useState, useEffect, useRef } from 'react'
import { useDeckSounds } from '../lib/sounds'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /**
   * Focus the input on mount. Default `false` — unconditional autofocus
   * can cause the browser to scroll the input into view on page load,
   * shifting wizard steps unexpectedly. Opt in only where the input is
   * unambiguously the primary action (e.g. homepage search).
   */
  autoFocus?: boolean
}

/**
 * Specimen search input.
 *
 * Sharp rectangle, hairline border, ash-filled — reads unmistakably as
 * an input field. Mono input (searches are commands). Focus lights the
 * border ink-red. Escape clears.
 */
export function SearchInput({ value, onChange, placeholder, autoFocus = false }: SearchInputProps) {
  const sounds = useDeckSounds()
  const [localValue, setLocalValue] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  function handleChange(newValue: string) {
    setLocalValue(newValue)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(newValue), 300)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setLocalValue('')
      onChange('')
    } else if (e.key.length === 1) {
      sounds.typing()
    }
  }

  return (
    <div className="group relative flex items-center border border-hairline-strong bg-ash-800 px-3 transition-colors focus-within:border-cream-200">
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-transparent py-3 font-mono text-mono-label text-cream-100 placeholder-cream-400 focus:outline-none"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
      />
      {localValue && (
        <button
          type="button"
          onClick={() => {
            setLocalValue('')
            onChange('')
          }}
          className="ml-2 font-mono text-mono-label text-cream-400 transition-colors hover:text-ink-red-bright"
          aria-label="Clear"
        >
          {'\u00D7'}
        </button>
      )}
    </div>
  )
}
