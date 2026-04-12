import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { memo, useState, useCallback, useMemo, useEffect } from 'react'
import { Layout } from '../../components/Layout'
import { SearchInput } from '../../components/SearchInput'
import { CardStack } from '../../components/CardStack'
import { CardImage } from '../../components/CardImage'
import { CardLightbox } from '../../components/CardLightbox'
import { DeckCardList } from '../../components/DeckCardList'
import { BalanceAdvisor } from '../../components/BalanceAdvisor'
import { AiChat } from '../../components/AiChat'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { SectionLaneHeader } from '../../components/ui/SectionLaneHeader'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/utils'
import { analyzeDeck } from '../../lib/balance'
import { useDeckChat } from '../../lib/useDeckChat'
import { searchCards, getCardById, getCardInLang } from '../../lib/scryfall/client'
import { loadDeck, persistDeck, type LocalDeck } from '../../lib/deck-storage'
import { localizeDeckSection } from '../../lib/section-plan'
import type { ManaColor } from '../../components/ManaSymbol'
import type { ScryfallCard } from '../../lib/scryfall/types'
import type { DeckCard, DeckZone } from '../../lib/deck-utils'
import { getTotalCards, copyDecklistToClipboard, FORMAT_LABELS } from '../../lib/deck-utils'
import { useT, useI18n } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'

type DeckDisplayCard = DeckCard & { card: ScryfallCard }

interface SectionLaneProps {
  label: string
  sectionLetter?: string
  targetCount?: number
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

// TODO: unify with wizard/StepDeckFill SectionLane once the drift narrows —
// that one carries a progress bar, preview/loading/error states, and fill
// buttons that this view-mode lane does not need.
const SectionLane = memo(function SectionLane({
  label, sectionLetter, targetCount, isCore, isLands, items, newCardIds, editing,
  onOpenLightbox, onToggleLock, onUpdateQuantity, onRemoveCard,
}: SectionLaneProps) {
  const [collapsed, setCollapsed] = useState(false)
  const count = items.reduce((s, d) => s + d.quantity, 0)
  const hasTarget = typeof targetCount === 'number' && targetCount > 0
  const underFilled = hasTarget && count < targetCount!
  const overFilled = hasTarget && count > targetCount!

  return (
    <div className={cn('relative', isCore && 'pl-3')}>
      {/* Core section marker — ink-red slab on the left edge */}
      {isCore && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-0 top-2 w-[3px] bg-ink-red"
        />
      )}

      <SectionLaneHeader
        letter={sectionLetter}
        label={label}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        count={
          hasTarget ? (
            <span
              className={cn(
                'tabular-nums',
                overFilled
                  ? 'text-ink-red-bright'
                  : underFilled
                    ? 'text-cream-400'
                    : 'text-cream-100',
              )}
            >
              {count} / {targetCount}
            </span>
          ) : (
            <span className="tabular-nums text-cream-300">{count}</span>
          )
        }
      />

      {!collapsed && (
        <div
          className={
            isLands
              ? 'grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8'
              : 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
          }
        >
          {items.map(({ card, quantity, locked, scryfallId }) => (
            <CardStack
              key={scryfallId}
              card={card}
              quantity={quantity}
              locked={locked}
              isNew={newCardIds.has(scryfallId)}
              onClick={() => onOpenLightbox(card)}
              onToggleLock={editing ? () => onToggleLock(scryfallId) : undefined}
              onChangeQuantity={editing ? (qty) => onUpdateQuantity(scryfallId, 'main', qty) : undefined}
              onRemove={editing ? () => onRemoveCard(scryfallId, 'main') : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export const Route = createFileRoute('/deck/$id')({
  // TODO: deck data lives in localStorage and loads post-mount, so a dynamic
  // title would require a route loader — static fallback for now.
  head: () => ({
    meta: [{ title: 'Deck — Manaschmiede' }],
  }),
  component: DeckPage,
})

type MobileTab = 'cards' | 'chat' | 'stats'

function DeckPage() {
  const t = useT()
  const sounds = useDeckSounds()
  const navigate = useNavigate()
  const toast = useToast()
  const { scryfallLang } = useI18n()
  const { id } = Route.useParams()
  const [deck, setDeck] = useState<LocalDeck | null>(null)
  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [cardDataMap, setCardDataMap] = useState<Map<string, ScryfallCard>>(new Map())
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  // Search (edit mode only)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)

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

  // Derive deck colors from card data when all cards are resolved
  useEffect(() => {
    if (!deck || deck.cards.length === 0 || cardDataMap.size === 0) return
    const allResolved = deck.cards.every((dc) => cardDataMap.has(dc.scryfallId))
    if (!allResolved) return
    const ORDER: ManaColor[] = ['W', 'U', 'B', 'R', 'G']
    const colorSet = new Set<ManaColor>()
    for (const dc of deck.cards) {
      const card = cardDataMap.get(dc.scryfallId)
      if (card) {
        for (const c of card.color_identity) colorSet.add(c as ManaColor)
      }
    }
    const derived = ORDER.filter((c) => colorSet.has(c))
    const prev = deck.colors ?? []
    if (derived.length !== prev.length || derived.some((c, i) => c !== prev[i])) {
      setDeck((d) => (d ? { ...d, colors: derived.length > 0 ? derived : undefined } : d))
    }
  }, [deck?.cards, cardDataMap])

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
      toast.success('PDF ready')
    } catch (err) {
      console.error('PDF generation failed:', err)
      toast.error('PDF generation failed')
    } finally {
      setPdfGenerating(false)
    }
  }, [deck, cardDataMap, toast])

  // ─── Computed ────────────────────────────────────────────────

  const analysis = useMemo(() => {
    if (!deck || deck.cards.length === 0) return null
    return analyzeDeck(deck.cards, cardDataMap, 'casual', t)
  }, [deck?.cards, cardDataMap, t])

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

  // Build ordered section list for display. Persisted section plans freeze
  // their label/description at creation time, so we re-localize each entry
  // against the active locale before rendering.
  const orderedSections = useMemo(() => {
    const plan = deck?.sectionPlan ?? []
    const sections: { id: string; label: string; targetCount?: number }[] = []

    if (sectionCards['core']) sections.push({ id: 'core', label: t('fill.laneCore') })

    if (plan.length > 0) {
      for (const s of plan) {
        if (s.id !== 'lands' && sectionCards[s.id]) {
          const localized = localizeDeckSection(s, t)
          sections.push({ id: s.id, label: localized.label, targetCount: s.targetCount })
        }
      }
    } else {
      // Fallback labels
      if (sectionCards['creatures']) sections.push({ id: 'creatures', label: t('fill.laneCreatures') })
      if (sectionCards['spells']) sections.push({ id: 'spells', label: t('fill.laneSpells') })
      if (sectionCards['support']) sections.push({ id: 'support', label: t('fill.laneSupport') })
    }

    if (sectionCards['unassigned']) sections.push({ id: 'unassigned', label: t('fill.unassigned') })
    if (sectionCards['lands']) {
      const landsPlan = plan.find((p) => p.id === 'lands')
      sections.push({ id: 'lands', label: t('fill.laneLands'), targetCount: landsPlan?.targetCount })
    }

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

  const renderLightboxActions = useCallback(
    (card: ScryfallCard) => (
      <Button
        variant="primary"
        size="md"
        className="w-full"
        onClick={() => {
          sounds.uiClick()
          navigate({ to: '/deck/new', search: { seed: card.id } })
        }}
      >
        {t('wizard.forgeWithCard')}
      </Button>
    ),
    [navigate, sounds, t],
  )

  if (!deck) {
    return (
      <Layout>
        <EmptyState title={t('deck.deckNotFound')} className="py-24" />
      </Layout>
    )
  }

  const mainCount = getTotalCards(deck.cards, 'main')

  // ─── Card Grid Content ───────────────────────────────────────

  const cardGridContent = (
    <>
      {/* Search results (edit mode) */}
      {editing && newSearchResults.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('fill.addToDeck')}
          </h4>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {newSearchResults.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => addCard(card)}
                className="group relative overflow-hidden border border-hairline opacity-80 transition-all hover:-translate-y-1 hover:border-ink-red hover:opacity-100"
              >
                <CardImage card={card} size="normal" />
                <span className="absolute inset-x-0 bottom-0 translate-y-full bg-ink-red py-1.5 text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-100 transition-transform duration-150 group-hover:translate-y-0">
                  + {t('deckPage.addOverlay')}
                </span>

              </button>
            ))}
          </div>
        </div>
      )}

      {searching && (
        <p className="py-4 text-center font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
          {t('search.searching')}
        </p>
      )}

      {/* Section-based deck display */}
      {orderedSections.length > 0 ? (
        <div className="space-y-10">
          {orderedSections.map((section, i) => (
            <SectionLane
              key={section.id}
              label={section.label}
              sectionLetter={String.fromCharCode(65 + i)}
              targetCount={section.targetCount}
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
        <EmptyState
          title={t('deck.emptyDeck')}
          description={t('deck.emptyDeckSub')}
          className="min-h-[200px] py-16"
        />
      )}
    </>
  )

  // ─── Render ──────────────────────────────────────────────────

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        {/* ─── HEADER ────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-ink-red-bright">
              {FORMAT_LABELS[deck.format]}
            </span>
            {editing ? (
              <>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => updateDeckName(e.target.value)}
                  onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
                  className="mt-2 w-full border-0 border-b border-hairline bg-transparent font-display text-2xl uppercase tracking-display text-cream-100 focus:border-cream-200 focus:outline-none sm:text-display-section"
                  placeholder={t('deck.namePlaceholder')}
                />
                <input
                  type="text"
                  value={deckDescription}
                  onChange={(e) => updateDeckDescription(e.target.value)}
                  onKeyDown={(e) => e.key.length === 1 && sounds.typing()}
                  className="mt-3 w-full border-0 border-b border-hairline bg-transparent font-body text-sm italic text-cream-400 focus:border-cream-200 focus:outline-none"
                  placeholder={t('deck.descriptionPlaceholder')}
                />
              </>
            ) : (
              <>
                <h1 className="mt-2 font-display text-2xl uppercase leading-tight tracking-display text-cream-100 sm:text-display-section">
                  {deckName}
                </h1>
                {deckDescription && (
                  <p className="mt-2 font-body text-sm italic text-cream-400">{deckDescription}</p>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="font-mono text-mono-num tabular-nums text-cream-300">
              {t('deck.cards', { count: mainCount })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const ok = await copyDecklistToClipboard(deck.cards, cardDataMap)
                if (ok) toast.info('Decklist copied to clipboard')
                else toast.error('Could not copy decklist')
              }}
            >
              {t('action.copy')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={pdfGenerating || mainCount === 0}
            >
              {pdfGenerating ? t('deck.pdfGenerating') : t('deck.pdf')}
            </Button>
            <Button
              variant={editing ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setEditing(!editing)}
            >
              {editing ? t('deck.doneEditing') : t('deck.editMode')}
            </Button>
          </div>
        </header>

        {editing ? (
          <>
            {/* ========== EDIT MODE: MOBILE (< lg) ========== */}
            <div className="lg:hidden">
              <Tabs
                className="mb-6"
                value={mobileTab}
                onChange={(id) => setMobileTab(id as MobileTab)}
                items={[
                  { id: 'cards', label: t('deck.paneCards'), panelId: 'tabpanel-cards' },
                  { id: 'chat', label: t('deck.paneChat'), panelId: 'tabpanel-chat' },
                  { id: 'stats', label: t('deck.paneStats'), panelId: 'tabpanel-stats' },
                ]}
              />

              {mobileTab === 'cards' && (
                <div id="tabpanel-cards" role="tabpanel" aria-labelledby="tab-cards" className="space-y-4">
                  <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
                  {cardGridContent}
                </div>
              )}

              {mobileTab === 'chat' && (
                <div id="tabpanel-chat" role="tabpanel" aria-labelledby="tab-chat" className="border border-hairline bg-ash-800/40" style={{ height: 'calc(100dvh - 240px)' }}>
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
                <div id="tabpanel-stats" role="tabpanel" aria-labelledby="tab-stats" className="space-y-4">
                  <BalanceAdvisor analysis={analysis} />
                  <div className="border border-hairline bg-ash-800/40 p-3">
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
            <div className="hidden lg:grid lg:grid-cols-12 lg:gap-4" style={{ height: 'calc(100dvh - 220px)' }}>
              {/* Left: AI Chat */}
              <div className="flex min-h-0 flex-col lg:col-span-3">
                <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                  {t('deck.paneChat')}
                </span>
                <div className="min-h-0 flex-1 border border-hairline bg-ash-800/40">
                  <AiChat
                    messages={messages}
                    pending={pending}
                    onSend={sendMessage}
                    onApply={applyChanges}
                    onDiscard={discardChanges}
                    isLoading={chatLoading}
                  />
                </div>
              </div>

              {/* Center: Card grid + search */}
              <div className="flex min-h-0 flex-col lg:col-span-6">
                <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                  {t('deck.paneCards')}
                </span>
                <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
                <div className="mt-3 flex-1 overflow-y-auto border border-hairline bg-ash-800/40 p-4">
                  {cardGridContent}
                </div>
              </div>

              {/* Right: Balance + Card list */}
              <div className="flex min-h-0 flex-col lg:col-span-3">
                <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
                  {t('deck.paneBalance')}
                </span>
                <BalanceAdvisor analysis={analysis} />
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto border border-hairline bg-ash-800/40 p-3">
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
          /* ========== VIEW MODE — reading-mode airy ========== */
          <div className="mx-auto w-full max-w-4xl space-y-12 pt-6">
            {cardGridContent}
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
          renderActions={renderLightboxActions}
        />
      )}
    </Layout>
  )
}
