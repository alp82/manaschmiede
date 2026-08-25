/**
 * The Scryfall client's rate-limit gate.
 *
 * The gate is the one part of `scryfall/client.ts` worth testing without a
 * network, because getting it wrong is invisible: it produces a correct page
 * that is simply too slow to finish. It once chained each request onto the
 * *completion* of the previous one, which serialized every Scryfall call in
 * the app behind whatever was in flight. The decks page's card lookups then
 * cost one full round trip each and the page painted blank plates.
 *
 * Fake timers keep this instant - the suite runs in about a second and stays
 * that way. `lastRequestTime` is module state that outlives a test, so each
 * test starts the clock further ahead than the last one left it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCardByName } from '../scryfall/client'

/** Must match `MIN_REQUEST_INTERVAL` in the client. */
const SPACING = 75
const ROUND_TRIP = 400

let epoch = 1_700_000_000_000

beforeEach(() => {
  vi.useFakeTimers()
  epoch += 1_000_000
  vi.setSystemTime(epoch)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Scryfall request gate', () => {
  it('spaces request starts without serializing their round trips', async () => {
    const t0 = Date.now()
    const starts: number[] = []
    vi.stubGlobal('fetch', () => {
      starts.push(Date.now() - t0)
      return new Promise((resolve) =>
        setTimeout(() => resolve({ ok: true, json: async () => ({ id: 'x' }) }), ROUND_TRIP),
      )
    })

    const names = ['a', 'b', 'c', 'd', 'e']
    const done = Promise.all(
      names.map((n) => getCardByName(n).then(() => Date.now() - t0)),
    )
    await vi.advanceTimersByTimeAsync(ROUND_TRIP * names.length * 2)
    const finishedAt = await done

    expect(starts).toHaveLength(names.length)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(SPACING)
    }
    // Spacing for the whole burst plus ONE round trip. Chaining on completion
    // would cost `names.length` round trips instead.
    expect(Math.max(...finishedAt)).toBeLessThan(SPACING * names.length + ROUND_TRIP * 1.5)
  })

  it('lets a later request through after an earlier one fails', async () => {
    let call = 0
    vi.stubGlobal('fetch', async () => {
      call++
      if (call === 1) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ details: 'gone' }),
        }
      }
      return { ok: true, json: async () => ({ id: 'second' }) }
    })

    const failed = getCardByName('missing')
    failed.catch(() => {})
    const after = getCardByName('present')
    await vi.advanceTimersByTimeAsync(SPACING * 10)

    await expect(failed).rejects.toThrow('Scryfall 404: gone')
    await expect(after).resolves.toEqual({ id: 'second' })
  })
})
