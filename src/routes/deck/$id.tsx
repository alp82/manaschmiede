import { createFileRoute } from '@tanstack/react-router'
import { memo, useState, useCallback, useMemo, useEffect } from 'react'
import { Layout } from '../../components/Layout'
import { SearchInput } from '../../components/SearchInput'
import { CardStack } from '../../components/CardStack'
import { CardImage } from '../../components/CardImage'
import { CardLightbox } from '../../components/CardLightbox'
import { DeckCardList } from '../../components/DeckCardList'
import { BalanceAdvisor } from '../../components/BalanceAdvisor'
import { AiChat } from '../../components/AiChat'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import { searchCards, getCardById, getCardInLang } from '../../lib/scryfall/client'
import { loadDeck, persistDeck, type LocalDeck } from '../../lib/deck-storage'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../../lib/deck-utils'
import { getTotalCards, copyDecklistToClipboard } from '../../lib/deck-utils'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'

type DeckDisplayCard = DeckCard & { card: ScryfallCard }

interface SectionLaneProps {
  label: string
  isCore?: boolean
  isLands?: boolean
  items: DeckDisplayCard[]
  newCardIds: Set<string>
  editing: boolean
  onOpenLightbox: (card: ScryfallCard) => void
  onToggleLock: (scryfallId: string) => void
  onUpdateQuantity: (scryfallId: string, zone: DeckZone, qty: number) => void
  onRemoveCard: (scryfallId: string, zone: DeckZone) => void
}

const SectionLane = memo(function SectionLane({
  label, isCore, isLands, items, newCardIds, editing,
  onOpenLightbox, onToggleLock, onUpdateQuantity, onRemoveCard,
}: SectionLaneProps) {
  const [collapsed, setCollapsed] = useState(false)
  const count = items.reduce((s, d) => s + d.quantity, 0)

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="mb-1 flex w-full items-center justify-between"
      >
        <span className="font-display text-sm font-bold text-surface-200">{label}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-surface-700 px-2 py-0.5 text-xs font-medium text-surface-400">{count}</span>
          <span className={`text-xs text-surface-500 transition-transform duration-[--duration-quick] ${collapsed ? '' : 'rotate-90'}`}>▸</span>
        </span>
      </button>
      {!collapsed && (
        <div className={isLands
          ? 'grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'
          : 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
        }>
          {items.map(({ card, quantity, locked, scryfallId }) => (
            <div key={scryfallId}>
              {isCore ? (
                <div className="ring-2 ring-mana-multi/50 rounded-lg">
                  <CardStack card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => onOpenLightbox(card)} onToggleLock={editing ? () => onToggleLock(scryfallId) : undefined} onChangeQuantity={editing ? (qty) => onUpdateQuantity(scryfallId, 'main', qty) : undefined} onRemove={editing ? () => onRemoveCard(scryfallId, 'main') : undefined} />
                </div>
              ) : (
                <CardStack card={card} quantity={quantity} locked={locked} isNew={newCardIds.has(scryfallId)} onClick={() => onOpenLightbox(card)} onToggleLock={editing ? () => onToggleLock(scryfallId) : undefined} onChangeQuantity={editing ? (qty) => onUpdateQuantity(scryfallId, 'main', qty) : undefined} onRemove={editing ? () => onRemoveCard(scryfallId, 'main') : undefined} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export const Route = createFileRoute('/deck/$id')({
  component: DeckPage,
})

type MobileTab = 'cards' | 'chat' | 'stats'

function DeckPage() {
  const t = useT()
  const sounds = useDeckSounds()
  const { scryfallLang } = useI18n()
  const { id } = Route.useParams()
  const [deck, setDeck] = useState<LocalDeck | null>(null)
  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')
  const [copied, setCopied] = useState(false)
  const [pdfGenerating, setPdfGenerating] = useState(false)

  // Search (edit mode only)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t) } }, [copied])

  // Load deck
  useEffect(() => {
    const loaded = loadDeck(id)
    if (loaded) {
      setDeck(loaded)
      setDeckName(loaded.name)
      setDeckDescription(loaded.description || '')
    }
  }, [id])

  // Auto-save
  useEffect(() => {
    if (!deck) return
    const timer = setTimeout(() => persistDeck(deck), 500)
    return () => clearTimeout(timer)
  }, [deck])

  // Fetch card data
  useEffect(() => {
    if (!deck) return
    for (const dc of deck.cards) {
      const existing = cardDataMap.get(dc.scryfallId)
      if (existing && existing.lang === scryfallLang) continue
      const fetchCard = existing
        ? getCardInLang(existing.set, existing.collector_number, scryfallLang)
        : getCardById(dc.scryfallId)
      fetchCard
        .then((card: ScryfallCard) => {
          setCardDataMap((prev) => new Map(prev).set(dc.scryfallId, card))
        })
        .catch(() => {})
    }
  }, [deck?.cards.length, scryfallLang])

  // Search
  useEffect(() => {
    if (search.length < 1) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await searchCards(search)
        setSearchResults(result.data?.slice(0, 12) ?? [])
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [search])

  // ─── Deck Mutations ──────────────────────────────────────────

  const addCard = useCallback((card: ScryfallCard) => {
    if (!deck) return
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
    setDeck((prev) => {
      if (!prev) return prev
      const cards = [...prev.cards]
      const existing = cards.findIndex((c) => c.scryfallId === card.id && c.zone === 'main')
      if (existing >= 0) {
        cards[existing] = { ...cards[existing], quantity: cards[existing].quantity + 1 }
      } else {
        cards.push({ scryfallId: card.id, quantity: 1, zone: 'main' })
      }
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [deck])

  const updateQuantity = useCallback((scryfallId: string, zone: DeckZone, quantity: number) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId && c.zone === zone ? { ...c, quantity } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  const removeCard = useCallback((scryfallId: string, zone: DeckZone) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.filter((c) => !(c.scryfallId === scryfallId && c.zone === zone))
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  const updateDeckName = useCallback((name: string) => {
    setDeckName(name)
    setDeck((prev) => (prev ? { ...prev, name, updatedAt: Date.now() } : prev))
  }, [])

  const updateDeckDescription = useCallback((description: string) => {
    setDeckDescription(description)
    setDeck((prev) => (prev ? { ...prev, description, updatedAt: Date.now() } : prev))
  }, [])

  const toggleLock = useCallback((scryfallId: string) => {
    setDeck((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c) =>
        c.scryfallId === scryfallId ? { ...c, locked: !c.locked } : c,
      )
      return { ...prev, cards, updatedAt: Date.now() }
    })
  }, [])

  // ─── AI Chat (edit mode) ────────────────────────────────────

  const handleDeckUpdate = useCallback(
    (newCards: DeckCard[], name?: string, description?: string) => {
      setDeck((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          cards: newCards,
          name: name || prev.name,
          description: description || prev.description,
          updatedAt: Date.now(),
        }
      })
      if (name) setDeckName(name)
      if (description) setDeckDescription(description)
    },
    [],
  )

  const handleCardDataUpdate = useCallback((card: ScryfallCard) => {
    setCardDataMap((prev) => new Map(prev).set(card.id, card))
  }, [])

  const lockedCardIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of deck?.cards ?? []) {
      if (c.locked) ids.add(c.scryfallId)
    }
    return ids
  }, [deck?.cards])

  const {
    messages,
    isLoading: chatLoading,
    pending,
    newCardIds,
    sendMessage,
    applyChanges,
    discardChanges,
  } = useDeckChat({
    cards: deck?.cards ?? [],
    cardDataMap,
    deckDescription,
    onDeckUpdate: handleDeckUpdate,
    onCardDataUpdate: handleCardDataUpdate,
    lockedCardIds,
  })

  // ─── PDF ─────────────────────────────────────────────────────

  const handleDownloadPdf = useCallback(async () => {
    if (!deck) return
    setPdfGenerating(true)
    try {
      const { pdf } = await import('@react-pdf/renderer')
      const { DeckPdf } = await import('../../lib/pdf')
      const blob = await pdf(
        DeckPdf({ cards: deck.cards, cardData: cardDataMap }),
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${deck.name || 'deck'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF generation failed:', err)
    } finally {
      setPdfGenerating(false)
    }
  }, [deck, cardDataMap])

  // ─── Computed ────────────────────────────────────────────────

  const analysis = useMemo(() => {
    if (!deck || deck.cards.length === 0) return null
    return analyzeDeck(deck.cards, cardDataMap, 'casual')
  }, [deck?.cards, cardDataMap])

  const deckDisplay = useMemo((): DeckDisplayCard[] => {
    if (!deck) return []
    return deck.cards
      .filter((c) => c.zone === 'main')
      .flatMap((dc) => {
        const card = cardDataMap.get(dc.scryfallId)
        if (!card) return []
        return [{ ...dc, card }]
      })
  }, [deck?.cards, cardDataMap])

  const allScryfallCards = useMemo(() => deckDisplay.map((d) => d.card), [deckDisplay])

  // Build section-based card groups
  const sectionCards = useMemo(() => {
    const plan = deck?.sectionPlan ?? []
    const assignments = deck?.sectionAssignments ?? {}
    const result: Record<string, DeckDisplayCard[]> = {}
    const assigned = new Set<string>()

    // Core (locked cards)
    const core: DeckDisplayCard[] = []
    for (const d of deckDisplay) {
      if (d.locked) {
        core.push(d)
        assigned.add(d.scryfallId)
      }
    }
    if (core.length > 0) result['core'] = core

    // Section-assigned cards
    for (const section of plan) {
      if (section.id === 'lands') continue
      const sectionIds = new Set(assignments[section.id] ?? [])
      const cards: DeckDisplayCard[] = []
      for (const d of deckDisplay) {
        if (!assigned.has(d.scryfallId) && sectionIds.has(d.scryfallId)) {
          cards.push(d)
          assigned.add(d.scryfallId)
        }
      }
      if (cards.length > 0) result[section.id] = cards
    }

    // Lands
    const lands: DeckDisplayCard[] = []
    const landAssignIds = new Set(assignments['lands'] ?? [])
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId) && (d.card.type_line.toLowerCase().includes('land') || landAssignIds.has(d.scryfallId))) {
        lands.push(d)
        assigned.add(d.scryfallId)
      }
    }
    if (lands.length > 0) result['lands'] = lands

    // Fallback: unassigned cards grouped by type (for decks without section metadata)
    const unassigned: DeckDisplayCard[] = []
    for (const d of deckDisplay) {
      if (!assigned.has(d.scryfallId)) unassigned.push(d)
    }

    if (unassigned.length > 0) {
      if (plan.length === 0) {
        // No section plan - use type-based classification
        const creatures: DeckDisplayCard[] = []
        const spells: DeckDisplayCard[] = []
        const support: DeckDisplayCard[] = []
        for (const d of unassigned) {
          const type = d.card.type_line.toLowerCase()
          if (type.includes('creature')) creatures.push(d)
          else if (type.includes('instant') || type.includes('sorcery')) spells.push(d)
          else support.push(d)
        }
        if (creatures.length > 0) result['creatures'] = creatures
        if (spells.length > 0) result['spells'] = spells
        if (support.length > 0) result['support'] = support
      } else {
        result['unassigned'] = unassigned
      }
    }

    return result
  }, [deckDisplay, deck?.sectionPlan, deck?.sectionAssignments])

  // Build ordered section list for display
  const orderedSections = useMemo(() => {
    const plan = deck?.sectionPlan ?? []
    const sections: { id: string; label: string }[] = []

    if (sectionCards['core']) sections.push({ id: 'core', label: t('fill.laneCore') })

    if (plan.length > 0) {
      for (const s of plan) {
        if (s.id !== 'lands' && sectionCards[s.id]) {
          sections.push({ id: s.id, label: s.label })
        }
      }
    } else {
      // Fallback labels
      if (sectionCards['creatures']) sections.push({ id: 'creatures', label: t('fill.laneCreatures') })
      if (sectionCards['spells']) sections.push({ id: 'spells', label: t('fill.laneSpells') })
      if (sectionCards['support']) sections.push({ id: 'support', label: t('fill.laneSupport') })
    }

    if (sectionCards['unassigned']) sections.push({ id: 'unassigned', label: t('fill.unassigned') })
    if (sectionCards['lands']) sections.push({ id: 'lands', label: t('fill.laneLands') })

    return sections
  }, [deck?.sectionPlan, sectionCards, t])

  const newSearchResults = useMemo(() => {
    const deckIds = new Set(deck?.cards.map((c) => c.scryfallId) ?? [])
    return searchResults.filter((c) => !deckIds.has(c.id))
  }, [searchResults, deck?.cards])

  const openLightbox = useCallback((card: ScryfallCard) => {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) { setLightboxIndex(idx); sounds.cardOpen() }
  }, [allScryfallCards, sounds])

  if (!deck) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20 text-surface-500">{t('deck.deckNotFound')}</div>
      </Layout>
    )
  }

  const mainCount = getTotalCards(deck.cards, 'main')

  // ─── Card Grid Content ───────────────────────────────────────

  const cardGridContent = (
    <>
      {/* Search results (edit mode) */}
      {editing && newSearchResults.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-surface-400">{t('fill.addToDeck')}</h4>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {newSearchResults.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => addCard(card)}
                className="group relative rounded-lg transition-all opacity-70 hover:opacity-100"
              >
                <CardImage card={card} size="normal" />
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded bg-accent px-2 py-1 text-xs font-bold text-white">{t('deckPage.addOverlay')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && <p className="py-4 text-center text-xs text-surface-500">{t('search.searching')}</p>}

      {/* Section-based deck display */}
      {orderedSections.length > 0 ? (
        <div className="space-y-6">
          {orderedSections.map((section) => (
            <SectionLane
              key={section.id}
              label={section.label}
              isCore={section.id === 'core'}
              isLands={section.id === 'lands'}
              items={sectionCards[section.id] ?? []}
              newCardIds={newCardIds}
              editing={editing}
              onOpenLightbox={openLightbox}
              onToggleLock={toggleLock}
              onUpdateQuantity={updateQuantity}
              onRemoveCard={removeCard}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-surface-500">
          <p className="font-display text-lg">{t('deck.emptyDeck')}</p>
          <p className="text-sm">{t('deck.emptyDeckSub')}</p>
        </div>
      )}
    </>
  )

  // ─── Render ──────────────────────────────────────────────────

  return (
    <Layout>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => updateDeckName(e.target.value)}
                  onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
                  className="w-full bg-transparent font-display text-lg font-bold text-surface-100 focus:outline-none sm:text-xl"
                  placeholder={t('deck.namePlaceholder')}
                />
                <input
                  type="text"
                  value={deckDescription}
                  onChange={(e) => updateDeckDescription(e.target.value)}
                  onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
                  className="w-full bg-transparent text-xs text-surface-400 focus:outline-none"
                  placeholder={t('deck.descriptionPlaceholder')}
                />
              </>
            ) : (
              <>
                <h1 className="font-display text-lg font-bold text-surface-100 sm:text-xl">{deckName}</h1>
                {deckDescription && <p className="text-xs text-surface-400">{deckDescription}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400 sm:text-sm">{t('deck.cards', { count: mainCount })}</span>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyDecklistToClipboard(deck.cards, cardDataMap)
                if (ok) setCopied(true)
              }}
              className="rounded-lg border border-surface-600 px-2.5 py-1.5 text-xs text-surface-400 hover:border-surface-500 hover:text-surface-200 transition-colors"
            >
              {copied ? '\u2713 Copied' : '\u{1F4CB} Copy'}
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfGenerating || mainCount === 0}
              className="rounded-lg border border-surface-600 px-2.5 py-1.5 text-xs text-surface-400 hover:border-surface-500 hover:text-surface-200 disabled:opacity-50 transition-colors"
            >
              {pdfGenerating ? t('deck.pdfGenerating') : t('deck.pdf')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                editing
                  ? 'bg-mana-green text-white hover:opacity-90'
                  : 'bg-accent text-white hover:bg-accent-hover'
              }`}
            >
              {editing ? t('deck.doneEditing') : t('deck.editMode')}
            </button>
          </div>
        </div>

        {editing ? (
          <>
            {/* ========== EDIT MODE: MOBILE (< lg) ========== */}
            <div className="lg:hidden">
              <div className="mb-3 flex rounded-lg border border-surface-600 p-0.5">
                {([
                  { id: 'cards' as MobileTab, label: t('nav.cards') },
                  { id: 'chat' as MobileTab, label: 'AI Chat' },
                  { id: 'stats' as MobileTab, label: 'Stats' },
                ]).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMobileTab(tab.id)}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      mobileTab === tab.id
                        ? 'bg-accent text-white'
                        : 'text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {mobileTab === 'cards' && (
                <div>
                  <div className="mb-2">
                    <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
                  </div>
                  <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-3">
                    {cardGridContent}
                  </div>
                </div>
              )}

              {mobileTab === 'chat' && (
                <div style={{ height: 'calc(100dvh - 220px)' }}>
                  <AiChat
                    messages={messages}
                    pending={pending}
                    onSend={sendMessage}
                    onApply={applyChanges}
                    onDiscard={discardChanges}
                    isLoading={chatLoading}
                  />
                </div>
              )}

              {mobileTab === 'stats' && (
                <div>
                  <BalanceAdvisor analysis={analysis} />
                  <div className="mt-3 rounded-xl border border-surface-700 bg-surface-800/50 p-2">
                    <DeckCardList
                      cards={deck.cards}
                      cardData={cardDataMap}
                      zone="main"
                      onUpdateQuantity={updateQuantity}
                      onRemoveCard={removeCard}
                      onToggleLock={toggleLock}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ========== EDIT MODE: DESKTOP (>= lg) ========== */}
            <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3" style={{ height: 'calc(100dvh - 170px)' }}>
              {/* Left: AI Chat */}
              <div className="min-h-0 lg:col-span-3">
                <AiChat
                  messages={messages}
                  pending={pending}
                  onSend={sendMessage}
                  onApply={applyChanges}
                  onDiscard={discardChanges}
                  isLoading={chatLoading}
                />
              </div>

              {/* Center: Card grid + search */}
              <div className="flex min-h-0 flex-col gap-2 lg:col-span-6">
                <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
                <div className="flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-3">
                  {cardGridContent}
                </div>
              </div>

              {/* Right: Balance + Card list */}
              <div className="flex min-h-0 flex-col gap-2 lg:col-span-3">
                <BalanceAdvisor analysis={analysis} />
                <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-2">
                  <DeckCardList
                    cards={deck.cards}
                    cardData={cardDataMap}
                    zone="main"
                    onUpdateQuantity={updateQuantity}
                    onRemoveCard={removeCard}
                    onToggleLock={toggleLock}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ========== VIEW MODE ========== */
          <div className="mx-auto w-full max-w-5xl">
            <div className="overflow-y-auto rounded-xl border border-surface-700 bg-surface-800/50 p-4" style={{ maxHeight: 'calc(100dvh - 170px)' }}>
              {cardGridContent}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && allScryfallCards.length > 0 && (
        <CardLightbox
          cards={allScryfallCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </Layout>
  )
}
