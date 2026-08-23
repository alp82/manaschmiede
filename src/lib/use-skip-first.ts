import { useEffect, useRef } from 'react'

/**
 * Calls `callback` on every dependency change EXCEPT the very first render.
 *
 * The first invocation of the effect records that the component has mounted
 * (sets `hydrated.current = true`) and returns without calling `callback`. All
 * subsequent dep-changes call `callback` normally.
 *
 * This is a behaviour-preserving extraction of the skip-first-render guard that
 * appeared identically in `useDeckPending`, `useStagedRederive`, and
 * `ReopenComboPicker`.
 *
 * @param callback - The function to call on every dep-change after the first.
 * @param deps     - The dependency array (same semantics as `useEffect`).
 */
export function useSkipFirst(callback: () => void, deps: unknown[]): void {
  const hydrated = useRef(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true
      return
    }
    callback()
    // deps are forwarded; callback ref stability is the caller's responsibility
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
