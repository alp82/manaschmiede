import { useState, useEffect, useRef } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: SearchInputProps) {
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
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-xl border border-surface-600 bg-surface-800 px-4 py-3 text-lg text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        autoFocus
      />
      {localValue && (
        <button
          type="button"
          onClick={() => {
            setLocalValue('')
            onChange('')
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
        >
          x
        </button>
      )}
    </div>
  )
}
