import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { Layout } from '../../../components/Layout'
import type { ScryfallCard } from '../../../lib/scryfall/types'
import { getCardName, getCardImageUri } from '../../../lib/scryfall/types'
import type { DeckCard, DeckFormat } from '../../../lib/deck-utils'
import { getTotalCards } from '../../../lib/deck-utils'
import { useT } from '../../../lib/i18n'

export const Route = createFileRoute('/deck/$id/print')({
  component: PrintPreviewPage,
})

interface LocalDeck {
  id: string
  name: string
  format: DeckFormat
  cards: DeckCard[]
}

function PrintPreviewPage() {
  const t = useT()
  const { id } = Route.useParams()
  const [deck, setDeck] = useState<LocalDeck | null>(null)
  const [cardData, setCardData] = useState<Map<string, ScryfallCard>>(new Map())
  const [includeBasicLands, setIncludeBasicLands] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    const decks: LocalDeck[] = JSON.parse(localStorage.getItem('manaschmiede-decks') || '[]')
    const found = decks.find((d) => d.id === id) || null
    setDeck(found)
  }, [id])

  // Fetch card data
  useEffect(() => {
    if (!deck) return
    const fetchCards = async () => {
      for (const dc of deck.cards) {
        if (cardData.has(dc.scryfallId)) continue
        try {
          const res = await fetch(`https://api.scryfall.com/cards/${dc.scryfallId}?lang=de`)
          const card: ScryfallCard = await res.json()
          setCardData((prev) => new Map(prev).set(card.id, card))
          // Rate limit
          await new Promise((r) => setTimeout(r, 75))
        } catch {}
      }
    }
    fetchCards()
  }, [deck?.cards.length])

  const expandedCards = useMemo(() => {
    if (!deck) return []
    const result: { card: ScryfallCard; idx: number }[] = []
    let idx = 0
    for (const dc of deck.cards) {
      const card = cardData.get(dc.scryfallId)
      if (!card) continue
      if (!includeBasicLands && card.type_line.includes('Basic Land')) continue
      for (let i = 0; i < dc.quantity; i++) {
        result.push({ card, idx: idx++ })
      }
    }
    return result
  }, [deck?.cards, cardData, includeBasicLands])

  // Split into pages of 9
  const pages = useMemo(() => {
    const result: { card: ScryfallCard; idx: number }[][] = []
    for (let i = 0; i < expandedCards.length; i += 9) {
      result.push(expandedCards.slice(i, i + 9))
    }
    return result
  }, [expandedCards])

  async function handleDownload() {
    setGenerating(true)
    try {
      // Dynamic import to avoid SSR issues
      const { pdf } = await import('@react-pdf/renderer')
      const { DeckPdf } = await import('../../../lib/pdf')
      const blob = await pdf(
        <DeckPdf cards={deck!.cards} cardData={cardData} includeBasicLands={includeBasicLands} />,
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${deck!.name || 'deck'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF generation failed:', err)
      alert(t('print.pdfFailed'))
    } finally {
      setGenerating(false)
    }
  }

  if (!deck) {
    return (
      <Layout>
        <div className="py-20 text-center text-surface-500">{t('deck.deckNotFound')}</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link to="/deck/$id" params={{ id }} className="text-sm text-accent hover:underline">
              {t('print.backToDeck')}
            </Link>
            <h1 className="font-display text-2xl font-bold text-surface-100">
              {t('print.preview', { name: deck.name })}
            </h1>
            <p className="text-sm text-surface-400">
              {t('print.pageInfo', { cards: expandedCards.length, pages: pages.length })}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-surface-300">
              <input
                type="checkbox"
                checked={includeBasicLands}
                onChange={(e) => setIncludeBasicLands(e.target.checked)}
                className="rounded"
              />
              {t('print.includeBasicLands')}
            </label>
            <button
              type="button"
              onClick={handleDownload}
              disabled={generating || expandedCards.length === 0}
              className="rounded-lg bg-accent px-6 py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {generating ? t('print.generatingPdf') : t('print.downloadPdf')}
            </button>
          </div>
        </div>

        {/* Print preview */}
        <div className="space-y-8">
          {pages.map((pageCards, pageIdx) => (
            <div key={pageIdx} className="mx-auto">
              <p className="mb-1 text-xs text-surface-500">{t('print.page', { num: pageIdx + 1 })}</p>
              <div
                className="grid border border-surface-600 bg-white"
                style={{
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  aspectRatio: '210 / 297',
                  maxWidth: '500px',
                  padding: '4%',
                  gap: '1px',
                }}
              >
                {pageCards.map(({ card, idx }) => {
                  const imageUrl = getCardImageUri(card, 'normal')
                  return (
                    <div key={idx} className="border border-dashed border-gray-300" style={{ aspectRatio: '63 / 88' }}>
                      {imageUrl ? (
                        <img src={imageUrl} alt={getCardName(card)} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gray-100 text-xs text-gray-500">
                          {getCardName(card)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Fill empty slots */}
                {Array.from({ length: 9 - pageCards.length }, (_, i) => (
                  <div key={`empty-${i}`} className="border border-dashed border-gray-200" style={{ aspectRatio: '63 / 88' }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}
