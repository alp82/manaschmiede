import { Kbd } from './Kbd'

interface UndoRedoButtonsProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** When false (or omitted), the buttons are not rendered. Useful when the
   *  parent conditions on a card count before showing edit controls. */
  show?: boolean
  undoLabel: string
  redoLabel: string
}

/**
 * Shared undo/redo button pair used in the wizard header (StepDeckFill) and
 * the deck page header (deck/$id). Hairline-bordered mono buttons with
 * keyboard shortcut tooltips.
 */
export function UndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  show = true,
  undoLabel,
  redoLabel,
}: UndoRedoButtonsProps) {
  if (!show) return null

  return (
    <>
      <div className="group relative">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-8 cursor-pointer items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
          title={undoLabel}
        >
          <span aria-hidden="true" className="text-base leading-none">{'↩'}</span>
          {undoLabel}
        </button>
        <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <Kbd>{'⌘Z'}</Kbd>
        </div>
      </div>
      <div className="group relative">
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex h-8 cursor-pointer items-center gap-2 border border-hairline px-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300 transition-colors hover:border-hairline-strong hover:text-cream-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-red focus-visible:ring-offset-2 focus-visible:ring-offset-ash-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
          title={redoLabel}
        >
          <span aria-hidden="true" className="text-base leading-none">{'↪'}</span>
          {redoLabel}
        </button>
        <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <Kbd>{'⌘⇧Z'}</Kbd>
        </div>
      </div>
    </>
  )
}
