export interface ScryfallImageUris {
  small: string
  normal: string
  large: string
  png: string
  art_crop: string
  border_crop: string
}

export interface ScryfallCardFace {
  name: string
  printed_name?: string
  mana_cost?: string
  type_line: string
  printed_type_line?: string
  oracle_text?: string
  printed_text?: string
  colors?: string[]
  image_uris?: ScryfallImageUris
}

export interface ScryfallCard {
  id: string
  name: string
  printed_name?: string
  lang: string
  layout: string
  image_uris?: ScryfallImageUris
  card_faces?: ScryfallCardFace[]
  mana_cost?: string
  cmc: number
  type_line: string
  printed_type_line?: string
  oracle_text?: string
  printed_text?: string
  colors?: string[]
  color_identity: string[]
  set: string
  set_name: string
  rarity: string
  collector_number: string
  legalities: Record<string, string>
  prices?: Record<string, string | null>
  keywords?: string[]
}

export interface ScryfallList {
  object: 'list'
  total_cards: number
  has_more: boolean
  next_page?: string
  data: ScryfallCard[]
}

export interface ScryfallAutocomplete {
  object: 'catalog'
  total_values: number
  data: string[]
}

export interface ScryfallError {
  object: 'error'
  code: string
  status: number
  details: string
}

export function getCardName(card: ScryfallCard): string {
  return card.printed_name ?? card.name
}

export function getCardImageUri(
  card: ScryfallCard,
  size: keyof ScryfallImageUris = 'normal',
): string | undefined {
  if (card.image_uris) return card.image_uris[size]
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris[size]
  return undefined
}

export function getCardTypeLine(card: ScryfallCard): string {
  return card.printed_type_line ?? card.type_line
}
