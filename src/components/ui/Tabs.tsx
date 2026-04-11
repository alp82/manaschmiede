import { cn } from '../../lib/utils'

export interface TabItem {
  id: string
  label: string
  panelId?: string
}

interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

/**
 * Specimen Tabs — shares DNA with the Stepper. Mono-label items along a
 * horizontal hairline rule with a 2px ink-red slab under the active tab.
 * Inactive tabs are cream-500, active is cream-100. No chevrons, no bg
 * swaps, no rounded highlights.
 */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn('flex w-full items-stretch border-b border-hairline', className)}
    >
      {items.map((tab) => {
        const isActive = value === tab.id
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tab.panelId}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex-1 px-3 py-3 font-mono text-mono-label uppercase leading-none tracking-mono-label transition-colors',
              'cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900',
              isActive ? 'text-cream-100' : 'text-cream-500 hover:text-cream-300',
            )}
          >
            {tab.label}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute -bottom-px left-1/2 h-[2px] w-8 -translate-x-1/2 bg-ink-red"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
