/**
 * Canonical Scryfall IDs for basic lands. Core Set 2021 printings — chosen
 * for clean classic art with no promo variants, so the diff viewer doesn't
 * flip cards between identical-looking printings.
 */
export const BASIC_LAND_IDS: Record<string, string> = {
  W: '4be96696-aff8-4ef9-97dc-8221ef745de9', // Plains (M21)
  U: 'fc9a66a1-367c-4035-a22e-00fab55be5a0', // Island (M21)
  B: '30b3d647-3546-4ade-b395-f2370750a7a6', // Swamp (M21)
  R: 'b92c8925-ecfc-4ece-b83a-f12e98a938ab', // Mountain (M21)
  G: '3279314f-d639-4489-b2ab-3621bb3ca64b', // Forest (M21)
}

/** Map from English basic land name → canonical Scryfall ID. */
export const BASIC_LAND_NAMES: Record<string, string> = {
  Plains: BASIC_LAND_IDS.W,
  Island: BASIC_LAND_IDS.U,
  Swamp: BASIC_LAND_IDS.B,
  Mountain: BASIC_LAND_IDS.R,
  Forest: BASIC_LAND_IDS.G,
}

/** Set of canonical basic land IDs for O(1) membership checks. */
export const BASIC_LAND_ID_SET: ReadonlySet<string> = new Set(Object.values(BASIC_LAND_IDS))
