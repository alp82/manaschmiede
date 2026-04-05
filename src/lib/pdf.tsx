import { Document, Page, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { ScryfallCard } from './scryfall/types'
import { getCardImageUri } from './scryfall/types'
import type { DeckCard } from './deck-utils'

// Standard MTG card: 63mm x 88mm
// A4: 210mm x 297mm
// 3 cols x 3 rows = 9 cards per page
const CARD_W = 63 // mm
const CARD_H = 88 // mm
const PAGE_W = 210
const PAGE_H = 297
const MARGIN_X = (PAGE_W - CARD_W * 3) / 2
const MARGIN_Y = (PAGE_H - CARD_H * 3) / 2

const mm = (val: number) => `${val}mm`

const styles = StyleSheet.create({
  page: {
    width: mm(PAGE_W),
    height: mm(PAGE_H),
    paddingTop: mm(MARGIN_Y),
    paddingLeft: mm(MARGIN_X),
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#ffffff',
  },
  card: {
    width: mm(CARD_W),
    height: mm(CARD_H),
    borderWidth: 0.5,
    borderColor: '#cccccc',
    borderStyle: 'dashed',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
})

interface DeckPdfProps {
  cards: DeckCard[]
  cardData: Map<string, ScryfallCard>
  includeBasicLands?: boolean
}

export function DeckPdf({ cards, cardData, includeBasicLands = true }: DeckPdfProps) {
  // Expand cards by quantity
  const expanded: ScryfallCard[] = []
  for (const dc of cards) {
    const card = cardData.get(dc.scryfallId)
    if (!card) continue
    if (!includeBasicLands && card.type_line.includes('Basic Land')) continue
    for (let i = 0; i < dc.quantity; i++) {
      expanded.push(card)
    }
  }

  // Split into pages of 9
  const pages: ScryfallCard[][] = []
  for (let i = 0; i < expanded.length; i += 9) {
    pages.push(expanded.slice(i, i + 9))
  }

  if (pages.length === 0) {
    pages.push([])
  }

  return (
    <Document title="Manaschmiede - Deck Print">
      {pages.map((pageCards, pageIdx) => (
        <Page key={pageIdx} size="A4" style={styles.page}>
          {pageCards.map((card, cardIdx) => {
            const imageUrl = getCardImageUri(card, 'png') || getCardImageUri(card, 'large')
            return (
              <View key={cardIdx} style={styles.card}>
                {imageUrl && <Image src={imageUrl} style={styles.cardImage} />}
              </View>
            )
          })}
        </Page>
      ))}
    </Document>
  )
}
