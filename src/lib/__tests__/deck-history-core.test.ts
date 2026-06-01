/**
 * RED tests — deckHistoryCore does not exist yet.
 *
 * CHOICE: option (a) — extract snapshot/undo/redo math into a pure helper
 * and test that without a render harness. No React, no jsdom needed.
 *
 * Asserted signature:
 *
 *   interface DeckHistoryState {
 *     past: DeckCard[][]
 *     future: DeckCard[][]
 *     lastSnapshot: string   // JSON key of the most recently snapshotted cards
 *   }
 *
 *   interface DeckHistoryOpts {
 *     persist?: boolean       // when false, aux storage is never touched
 *     maxHistory?: number     // defaults to 30
 *   }
 *
 *   // Returned by createDeckHistoryCore — holds the mutable state object and
 *   // the three operations. Each operation returns the (possibly new) state.
 *
 *   interface DeckHistoryCore {
 *     state: DeckHistoryState
 *     snapshot(currentCards: DeckCard[]): DeckHistoryState
 *     undo(currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null }
 *     redo(currentCards: DeckCard[]): { state: DeckHistoryState; cards: DeckCard[] | null }
 *   }
 *
 *   createDeckHistoryCore(opts?: DeckHistoryOpts): DeckHistoryCore
 *
 * This pure core is what useDeckHistory wraps. The React hook stays unchanged
 * (still dispatches SET_DECK and persists via wizard-state aux). The pure core
 * is extracted so it can be unit-tested without React.
 *
 * persistWizardAux and loadWizardAux: when persist:false the core MUST NOT
 * call them. Tests verify by passing no-op mocks and asserting they're never
 * invoked. The signature of createDeckHistoryCore takes an optional inject for
 * aux fns so tests can stub them:
 *
 *   createDeckHistoryCore(opts?, aux?: {
 *     load: () => { deckHistoryPast: DeckCard[][], deckHistoryFuture: DeckCard[][] }
 *     persist: (data: { deckHistoryPast: DeckCard[][], deckHistoryFuture: DeckCard[][] }) => void
 *   })
 */
import { describe, it, expect, vi } from 'vitest'
import { createDeckHistoryCore } from '../use-deck-history'
import type { DeckCard } from '../deck-utils'

function cards(ids: string[]): DeckCard[] {
  return ids.map((id) => ({ scryfallId: id, quantity: 2, zone: 'main' as const }))
}

const noAux = {
  load: () => ({ deckHistoryPast: [], deckHistoryFuture: [] }),
  persist: vi.fn(),
}

describe('createDeckHistoryCore — persist:false', () => {
  it('snapshot pushes current cards onto past stack and clears future', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const initial = cards(['a', 'b'])
    core.snapshot(initial)
    expect(core.state.past).toHaveLength(1)
    expect(core.state.past[0]).toEqual(initial)
    expect(core.state.future).toHaveLength(0)
  })

  it('undo pops past and returns previous cards; redo returns null when future is empty', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const v1 = cards(['a'])
    const v2 = cards(['a', 'b'])
    core.snapshot(v1)   // past = [v1]
    const { cards: undoneCards } = core.undo(v2)  // current = v2; undo -> returns v1
    expect(undoneCards).toEqual(v1)
    expect(core.state.past).toHaveLength(0)
    expect(core.state.future).toHaveLength(1)
  })

  it('redo pops future and returns those cards', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const v1 = cards(['a'])
    const v2 = cards(['a', 'b'])
    core.snapshot(v1)
    core.undo(v2)                        // future = [v2], past = []
    const { cards: redoneCards } = core.redo(v1)  // current = v1; redo -> returns v2
    expect(redoneCards).toEqual(v2)
  })

  it('persist:false -> aux.persist is never called', () => {
    const persist = vi.fn()
    const aux = { load: () => ({ deckHistoryPast: [], deckHistoryFuture: [] }), persist }
    const core = createDeckHistoryCore({ persist: false }, aux)
    core.snapshot(cards(['x']))
    core.undo(cards(['y']))
    core.redo(cards(['x']))
    expect(persist).not.toHaveBeenCalled()
  })

  it('persist:false -> aux.load is never called on init', () => {
    const load = vi.fn(() => ({ deckHistoryPast: [], deckHistoryFuture: [] }))
    const aux = { load, persist: vi.fn() }
    createDeckHistoryCore({ persist: false }, aux)
    expect(load).not.toHaveBeenCalled()
  })

  it('duplicate-snapshot suppression: identical top-of-stack is not re-pushed', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const v = cards(['a', 'b'])
    core.snapshot(v)
    core.snapshot(v)   // same reference
    core.snapshot(JSON.parse(JSON.stringify(v)))  // same deep value, different reference
    expect(core.state.past).toHaveLength(1)
  })

  it('undo when past is empty returns null for cards', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const { cards: undoneCards } = core.undo(cards(['z']))
    expect(undoneCards).toBeNull()
  })

  it('redo when future is empty returns null for cards', () => {
    const core = createDeckHistoryCore({ persist: false }, noAux)
    const { cards: redoneCards } = core.redo(cards(['z']))
    expect(redoneCards).toBeNull()
  })
})

describe('createDeckHistoryCore — maxHistory eviction', () => {
  it('after N+1 distinct snapshots with maxHistory:N, past.length === N and oldest entry is evicted', () => {
    const N = 4
    const core = createDeckHistoryCore({ persist: false, maxHistory: N }, noAux)

    // Take N+1 distinct snapshots — each uses a unique id so duplicate-suppression
    // never fires. After the (N+1)th push the oldest entry must have been shifted off.
    const snapshots: DeckCard[][] = []
    for (let i = 0; i <= N; i++) {
      snapshots.push(cards([`card-${i}`]))
    }

    // Push them all — each is a new top-of-stack because id differs each time.
    for (const snap of snapshots) {
      core.snapshot(snap)
    }

    // Past must be capped at N.
    expect(core.state.past).toHaveLength(N)

    // The very first snapshot (snapshots[0]) must have been evicted.
    const oldestContent = JSON.stringify(snapshots[0])
    const foundOldest = core.state.past.some((p) => JSON.stringify(p) === oldestContent)
    expect(foundOldest).toBe(false)

    // The most-recent N entries (snapshots[1] … snapshots[N]) are retained, in order.
    for (let i = 0; i < N; i++) {
      expect(core.state.past[i]).toEqual(snapshots[i + 1])
    }
  })
})

describe('createDeckHistoryCore — persist:true', () => {
  it('restore reads aux.load on creation', () => {
    const past = [cards(['a']), cards(['b'])]
    const load = vi.fn(() => ({ deckHistoryPast: past, deckHistoryFuture: [] }))
    const core = createDeckHistoryCore({ persist: true }, { load, persist: vi.fn() })
    expect(load).toHaveBeenCalledOnce()
    expect(core.state.past).toEqual(past)
  })

  it('snapshot with persist:true calls aux.persist', () => {
    const persist = vi.fn()
    const core = createDeckHistoryCore(
      { persist: true },
      { load: () => ({ deckHistoryPast: [], deckHistoryFuture: [] }), persist },
    )
    core.snapshot(cards(['x']))
    expect(persist).toHaveBeenCalled()
  })

  it('undo with persist:true calls aux.persist', () => {
    const persist = vi.fn()
    const core = createDeckHistoryCore(
      { persist: true },
      { load: () => ({ deckHistoryPast: [], deckHistoryFuture: [] }), persist },
    )
    const v1 = cards(['a'])
    core.snapshot(v1)
    persist.mockClear()
    core.undo(cards(['a', 'b']))
    expect(persist).toHaveBeenCalled()
  })
})
