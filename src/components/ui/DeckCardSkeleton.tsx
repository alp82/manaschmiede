export function DeckCardSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="aspect-[488/680] animate-pulse bg-ash-800"
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
