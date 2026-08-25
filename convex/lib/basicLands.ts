/**
 * Everything the app knows about basic lands: the five names, the colour each
 * one produces, and the canonical Scryfall printing of each.
 *
 * One module because the facts used to live in two - a name set plus a
 * colour->name map inside `convex/generateDeck.ts`, and an id map plus a
 * different name map in `src/lib/basic-lands.ts` - and a sixth basic land
 * would have had to be added to both (issue #28).
 *
 * Zero runtime imports, so both trees reach it the same way they reach
 * `cardFilters.ts`. The one import allowed is another dependency-free module
 * from `convex/lib/`, and this file uses none.
 */

/** Colour letter -> the basic land that produces it. */
export const BASIC_LAND_NAME_BY_COLOR: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
}

/**
 * The five basic land names, in English Oracle spelling. Snow-covered and
 * Wastes variants are not listed - a type-line check catches those; this set
 * is the name-only fast path.
 */
export const BASIC_LAND_NAMES: ReadonlySet<string> = new Set(
  Object.values(BASIC_LAND_NAME_BY_COLOR),
)

/** True for the five English basic land names. */
export function isBasicLandName(name: string): boolean {
  return BASIC_LAND_NAMES.has(name)
}

/**
 * Colour letter -> canonical Scryfall ID. Core Set 2021 printings - chosen for
 * clean classic art with no promo variants, so the diff viewer doesn't flip
 * cards between identical-looking printings.
 */
export const BASIC_LAND_ID_BY_COLOR: Record<string, string> = {
  W: '4be96696-aff8-4ef9-97dc-8221ef745de9', // Plains (M21)
  U: 'fc9a66a1-367c-4035-a22e-00fab55be5a0', // Island (M21)
  B: '30b3d647-3546-4ade-b395-f2370750a7a6', // Swamp (M21)
  R: 'b92c8925-ecfc-4ece-b83a-f12e98a938ab', // Mountain (M21)
  G: '3279314f-d639-4489-b2ab-3621bb3ca64b', // Forest (M21)
}

/** English basic land name -> canonical Scryfall ID. */
export const BASIC_LAND_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(BASIC_LAND_NAME_BY_COLOR).map(([color, name]) => [
    name,
    BASIC_LAND_ID_BY_COLOR[color],
  ]),
)

/** Set of canonical basic land IDs for O(1) membership checks. */
export const BASIC_LAND_ID_SET: ReadonlySet<string> = new Set(
  Object.values(BASIC_LAND_ID_BY_COLOR),
)

/** True for a canonical basic land printing. */
export function isBasicLandId(id: string): boolean {
  return BASIC_LAND_ID_SET.has(id)
}
