import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react'
import { SectionLane, type SectionLaneDescriptor } from './SectionLane'
import { AiChat, type QuickAction } from '../AiChat'
import { BalanceAdvisor } from '../BalanceAdvisor'
import { CardLightbox } from '../CardLightbox'
import { CardStack } from '../CardStack'
import { CardImage } from '../CardImage'
import { SearchInput } from '../SearchInput'
import { Button } from '../ui/Button'
import { Pill } from '../ui/Pill'
import { Tabs } from '../ui/Tabs'
import { LoadingDots } from '../ui/LoadingDots'
import { DeckCardSkeleton } from '../ui/DeckCardSkeleton'
import { ConfirmModal } from '../ConfirmModal'
import { cn } from '../../lib/utils'
import { searchCards } from '../../lib/scryfall/client'
import { useT } from '../../lib/i18n'
import { useDeckSounds } from '../../lib/sounds'
import type { ScryfallCard } from '../../lib/scryfall/types'
import { getCardName } from '../../lib/scryfall/types'
import type { DeckCard, DeckDisplayCard } from '../../lib/deck-utils'
import { isBasicLand } from '../../lib/deck-utils'
import type { DeckSection } from '../../lib/section-plan'
import type { BalanceAnalysis } from '../../lib/balance'
import type { ChatMessage, PendingChanges } from '../../lib/useDeckChat'
import type { SectionFillState } from '../../lib/useSectionFill'
import type { ManaColor } from '../ManaSymbol'
import { buildLaneDescriptors, useDeckDisplay } from '../../lib/use-deck-sections'
import { buttonLikeBase } from '../ui/button-styles'

interface DeckEditorChat {
  messages: ChatMessage[]
  pending: PendingChanges | null
  isLoading: boolean
  newCardIds: Set<string>
  sendMessage: (text: string, options?: { targetSection?: string }) => void
  onApply: () => void
  onDiscard: () => void
}

interface DeckEditorFill {
  getSectionState: (sectionId: string) => SectionFillState
  onFillSection: (sectionId: string) => void
  onApplySection: (sectionId: string) => void
  onDiscardSection: (sectionId: string) => void
  onFillLands: () => void
  onFillAllRemaining: () => void
  fillProgress: { current: number; total: number; currentSection: string } | null
  onCancelFillAll: () => void
  landsNeedAdjustment: boolean
  unfilledCount: number
}

interface DeckEditorProps {
  cards: DeckCard[]
  cardDataMap: Map<string, ScryfallCard>
  /** Ordered, localized sections (id + label + targetCount + description). */
  sections: DeckSection[]
  /** Bucketed display cards keyed by section id (from useSectionCards). */
  sectionCards: Record<string, DeckDisplayCard[]>
  /** Read-only locked id set; the editor never owns a copy. */
  lockedCardIds: Set<string>
  editing: boolean
  onAddCard: (card: ScryfallCard) => void
  onToggleLock: (scryfallId: string) => void
  onChangeQuantity: (scryfallId: string, qty: number) => void
  onRemoveCard: (scryfallId: string) => void
  chat: DeckEditorChat
  analysis: BalanceAnalysis | null
  /** Wizard-only fill controls. When absent, no fill UI / progress / Fill-All. */
  fill?: DeckEditorFill
  /** Edit-only: Simulation + DeckCardList rail (Stats tab + desktop right rail). */
  cardListSlot?: ReactNode
  /** Wizard-only ambient gradient colors. */
  ambientColors?: ManaColor[]
  cardsLoading?: boolean
  /**
   * Route-specific extra lightbox actions, appended below the editor's own
   * quantity/remove controls. `close` dismisses the lightbox (the wizard's
   * "suggest replacement" closes it before sending the chat message).
   */
  renderExtraLightboxActions?: (card: ScryfallCard, close: () => void) => ReactNode
  /** Undo/redo handlers; the keyboard shortcut forwards to these when present. */
  onUndo?: () => void
  onRedo?: () => void
  /**
   * Appended to the search query (wizard supplies color/format/budget/rarity
   * constraints; the deck view searches unconstrained).
   */
  searchSuffix?: string
  /**
   * Extra space (px) reserved below the desktop grid for fixed bottom chrome.
   * The wizard's fixed WizardNav needs clearance; the deck route has none.
   */
  desktopBottomGap?: number
}

type MobileTab = 'cards' | 'chat' | 'stats'

const TINT_MAP: Record<string, string> = {
  W: 'oklch(0.92 0.04 90 / 0.05)',
  U: 'oklch(0.55 0.18 250 / 0.05)',
  B: 'oklch(0.30 0.02 285 / 0.08)',
  R: 'oklch(0.58 0.22 25 / 0.05)',
  G: 'oklch(0.60 0.18 145 / 0.05)',
}

/**
 * Shared chat / cards / stats workspace for the deck wizard (fill mode) and the
 * deck view (edit mode). Holds NO deck-card state — every mutation routes out
 * through callbacks. Owns only UI/interaction state: search + filters + lightbox
 * + mobile tab + undo/redo keyboard handler + the remove-card confirm.
 */
export function DeckEditor({
  cards,
  cardDataMap,
  sections,
  sectionCards,
  lockedCardIds,
  editing,
  onAddCard,
  onToggleLock,
  onChangeQuantity,
  onRemoveCard,
  chat,
  analysis,
  fill,
  cardListSlot,
  ambientColors,
  cardsLoading,
  renderExtraLightboxActions,
  onUndo,
  onRedo,
  searchSuffix = '',
  desktopBottomGap = 0,
}: DeckEditorProps) {
  const t = useT()
  const sounds = useDeckSounds()

  const [mobileTab, setMobileTab] = useState<MobileTab>('cards')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  // Search & filter
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([])
  const [searching, setSearching] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [cmcFilter, setCmcFilter] = useState<number | null>(null)

  // Desktop grid — compute height from position so internal panes scroll
  // independently under any fixed chrome around the editor.
  const desktopGridRef = useRef<HTMLDivElement>(null)
  const [desktopGridHeight, setDesktopGridHeight] = useState('calc(100dvh - 280px)')
  useEffect(() => {
    const el = desktopGridRef.current
    if (!el) return
    const update = () => {
      const top = el.getBoundingClientRect().top
      setDesktopGridHeight(`${window.innerHeight - top - desktopBottomGap}px`)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [desktopBottomGap])

  // Undo/redo keyboard shortcut — forwards to the route's history handlers.
  // Refs keep the listener stable while always seeing the latest handlers.
  const onUndoRef = useRef(onUndo)
  onUndoRef.current = onUndo
  const onRedoRef = useRef(onRedo)
  onRedoRef.current = onRedo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedoRef.current?.()
        else onUndoRef.current?.()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─── Search ──────────────────────────────────────────────────

  useEffect(() => {
    if (search.length < 1) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await searchCards(`${search}${searchSuffix}`)
        setSearchResults(result.data?.slice(0, 12) ?? [])
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 400)
    return () => clearTimeout(timer)
  }, [search, searchSuffix])

  // ─── Computed ────────────────────────────────────────────────

  const mainDisplay = useDeckDisplay(cards, cardDataMap)

  const filteredDisplay = useMemo(() => {
    return mainDisplay.filter((d) => {
      if (typeFilter && !d.card.type_line.toLowerCase().includes(typeFilter.toLowerCase())) return false
      if (colorFilter && !d.card.color_identity.includes(colorFilter)) return false
      if (cmcFilter !== null && Math.min(Math.floor(d.card.cmc), 7) !== cmcFilter) return false
      return true
    })
  }, [mainDisplay, typeFilter, colorFilter, cmcFilter])

  const allScryfallCards = useMemo(() => mainDisplay.map((d) => d.card), [mainDisplay])

  const newSearchResults = useMemo(() => {
    const deckIds = new Set(cards.map((c) => c.scryfallId))
    return searchResults.filter((c) => !deckIds.has(c.id))
  }, [searchResults, cards])

  const hasActiveFilter = typeFilter !== null || colorFilter !== null || cmcFilter !== null

  // Build the ordered lane list using the shared helper.
  // fill mode: include empty sections so fill buttons render for unfilled lanes.
  // edit/view mode: skip lanes with no cards.
  const lanes = useMemo(
    () =>
      buildLaneDescriptors(sections, sectionCards, t, {
        includeEmptySections: !!fill,
        fallbackByType: false,
      }),
    [sections, sectionCards, t, fill],
  )

  // Quick action chips for AI chat — surfaced when analysis flags a fixable issue.
  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = []
    if (analysis?.warnings.some((w) => w.message.toLowerCase().includes('land'))) {
      actions.push({ label: t('chat.quickFixMana'), message: 'Fix the mana base - adjust the land count and color distribution to match the spells.' })
    }
    if (analysis?.suggestions.some((s) => s.toLowerCase().includes('removal'))) {
      actions.push({ label: t('chat.quickAddRemoval'), message: 'Add some removal spells to deal with opponent threats.' })
    }
    return actions.slice(0, 3)
  }, [analysis, t])

  // ─── Handlers ────────────────────────────────────────────────

  const openLightbox = useCallback((card: ScryfallCard) => {
    const idx = allScryfallCards.findIndex((c) => c.id === card.id)
    if (idx >= 0) { setLightboxIndex(idx); sounds.cardOpen() }
  }, [allScryfallCards, sounds])

  const confirmRemoveCard = useCallback(() => {
    if (!pendingRemoveId) return
    onRemoveCard(pendingRemoveId)
    setPendingRemoveId(null)
  }, [pendingRemoveId, onRemoveCard])

  const clearFilters = useCallback(() => {
    setTypeFilter(null)
    setColorFilter(null)
    setCmcFilter(null)
  }, [])

  // Lightbox actions — editor-owned quantity/remove controls (edit mode only)
  // plus any route-specific extras (suggest replacement, forge with card).
  const renderLightboxActions = useCallback((card: ScryfallCard): ReactNode => {
    const close = () => setLightboxIndex(null)
    const extras = renderExtraLightboxActions?.(card, close)
    const deckCard = editing ? cards.find((c) => c.scryfallId === card.id && c.zone === 'main') : undefined

    if (!deckCard && !extras) return null

    const isLand = isBasicLand(card)
    const locked = lockedCardIds.has(card.id)

    return (
      <div className="space-y-3">
        {deckCard && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
              {t('fill.qty')}
            </span>
            <div className="flex items-center gap-1">
              {(isLand ? [1, 2, 3, 4, 6, 8, 10, 12] : [1, 2, 3, 4]).map((n) => (
                <Pill
                  key={n}
                  size="sm"
                  selected={n === deckCard.quantity}
                  onClick={() => { onChangeQuantity(card.id, n); sounds.uiClick() }}
                  className="h-8 w-8 p-0 tabular-nums"
                >
                  {n}
                </Pill>
              ))}
            </div>
            {!locked && !isLand && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { setLightboxIndex(null); setPendingRemoveId(card.id); sounds.uiClick() }}
                className="ml-auto"
              >
                {t('fill.remove')}
              </Button>
            )}
          </div>
        )}
        {extras}
      </div>
    )
  }, [renderExtraLightboxActions, editing, cards, lockedCardIds, onChangeQuantity, sounds, t])

  // Build the wizard's per-section fill button(s). Lands adjust their basic
  // count; non-land sections fill via the AI, or top up via chat once seeded.
  const renderFillSlot = useCallback((lane: SectionLaneDescriptor): ReactNode => {
    if (!fill) return null
    const items = sectionCards[lane.id] ?? []
    const count = items.reduce((s, d) => s + d.quantity, 0)
    const sState = fill.getSectionState(lane.id)
    const isFilled = sState.status === 'applied' || items.length > 0
    const target = lane.targetCount ?? 0

    const buttonClass = cn(
      buttonLikeBase,
      'mt-3 w-full border-dashed border-hairline-strong py-3 text-mono-label tracking-mono-label text-cream-400 hover:border-ink-red hover:text-cream-100',
    )

    if (lane.isLands) {
      if (!fill.landsNeedAdjustment) return null
      return (
        <button
          type="button"
          onClick={fill.onFillLands}
          disabled={!!fill.fillProgress}
          className={buttonClass}
        >
          {isFilled ? t('fill.topUpLands') : t('fill.autoFillLands')}
        </button>
      )
    }

    if (count >= target) return null

    if (isFilled) {
      const needed = target - count
      return (
        <button
          type="button"
          onClick={() => {
            chat.sendMessage(
              `Add ${needed} more cards to the "${lane.label}" section. Keep the existing cards and add cards that fit the section's role: ${lane.description ?? lane.label}.`,
              { targetSection: lane.id },
            )
            if (mobileTab !== 'chat') setMobileTab('chat')
          }}
          disabled={chat.isLoading}
          className={buttonClass}
        >
          {`${t('fill.topUp')} (+${needed})`}
        </button>
      )
    }

    return (
      <button
        type="button"
        onClick={() => fill.onFillSection(lane.id)}
        disabled={!!fill.fillProgress}
        className={buttonClass}
      >
        {`${t('fill.fillSection')} (${t('fill.cardsCountShort', { count: target })})`}
      </button>
    )
  }, [fill, sectionCards, chat, mobileTab, t])

  // ─── Card grid (search results + section lanes) ──────────────

  const cardGridContent = (
    <>
      {/* Search results: cards to add (direct-add on click) */}
      {newSearchResults.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-3 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('fill.addToDeck')}
          </h4>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {newSearchResults.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => onAddCard(card)}
                aria-label={`Add ${getCardName(card)}`}
                className="group relative cursor-pointer overflow-hidden border border-hairline opacity-80 transition-all hover:-translate-y-1 hover:border-ink-red hover:opacity-100"
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

      {/* Fill All button (wizard) */}
      {fill && fill.unfilledCount > 0 && !fill.fillProgress && (
        <div className="mb-6">
          <Button variant="primary" size="lg" onClick={fill.onFillAllRemaining} className="w-full">
            {t('fill.fillAll')} ({t('fill.sectionCount', { count: fill.unfilledCount })})
          </Button>
        </div>
      )}

      {/* Fill All progress (wizard) */}
      {fill?.fillProgress && (
        <div className="mb-6 flex items-center justify-between border border-ink-red px-4 py-3">
          <div className="flex items-center gap-3">
            <LoadingDots size="md" tone="bright" />
            <span className="font-mono text-mono-label uppercase tabular-nums tracking-mono-label text-cream-100">
              {t('fill.fillingProgress', { current: fill.fillProgress.current, total: fill.fillProgress.total })}
              <span className="ml-2 text-cream-400">· {fill.fillProgress.currentSection}</span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={fill.onCancelFillAll}>
            {t('fill.cancel')}
          </Button>
        </div>
      )}

      {/* Deck sections */}
      {hasActiveFilter ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {filteredDisplay.map(({ card, quantity, locked, scryfallId }) => (
            <CardStack
              key={scryfallId}
              card={card}
              quantity={quantity}
              locked={locked}
              isNew={chat.newCardIds.has(scryfallId)}
              onClick={() => openLightbox(card)}
              onToggleLock={editing ? () => onToggleLock(scryfallId) : undefined}
              onChangeQuantity={editing ? (qty) => onChangeQuantity(scryfallId, qty) : undefined}
              onRemove={editing ? () => setPendingRemoveId(scryfallId) : undefined}
            />
          ))}
        </div>
      ) : lanes.length > 0 ? (
        <div className={cn(fill ? '[&>*+*]:mt-16 [&>*+*]:border-t-2 [&>*+*]:border-cream-500/70 [&>*+*]:pt-16' : 'space-y-10')}>
          {lanes.map((lane) => {
            const sState = fill?.getSectionState(lane.id)
            return (
              <SectionLane
                key={lane.id}
                section={lane}
                items={sectionCards[lane.id] ?? []}
                newCardIds={chat.newCardIds}
                editing={editing}
                onOpenLightbox={openLightbox}
                onToggleLock={onToggleLock}
                onChangeQuantity={onChangeQuantity}
                onRemoveCard={setPendingRemoveId}
                fillSlot={fill ? renderFillSlot(lane) : undefined}
                sectionState={
                  fill && sState
                    ? {
                        fillState: sState,
                        onApplySection: () => fill.onApplySection(lane.id),
                        onRetrySection: () => fill.onFillSection(lane.id),
                        onDiscardSection: () => fill.onDiscardSection(lane.id),
                      }
                    : undefined
                }
              />
            )
          })}
        </div>
      ) : cardsLoading || mainDisplay.length === 0 ? (
        <DeckCardSkeleton />
      ) : null}
    </>
  )

  // ─── Render ──────────────────────────────────────────────────

  const ambientGradient = useMemo(() => {
    if (!ambientColors || ambientColors.length === 0) return undefined
    const primary = TINT_MAP[ambientColors[0]] ?? 'transparent'
    const secondary = ambientColors.length > 1 ? (TINT_MAP[ambientColors[1]] ?? 'transparent') : primary
    return `radial-gradient(ellipse at 50% 0%, ${primary} 0%, ${secondary} 40%, transparent 80%)`
  }, [ambientColors])

  const searchRow = (
    <div className="flex gap-2">
      <div className="flex-1">
        <SearchInput value={search} onChange={setSearch} placeholder={t('fill.searchPlaceholder')} />
      </div>
      {hasActiveFilter && (
        <Button variant="secondary" size="sm" onClick={clearFilters}>
          {t('fill.clearFilters')}
        </Button>
      )}
    </div>
  )

  const balancePane = (
    <BalanceAdvisor
      analysis={analysis}
      activeTypeFilter={typeFilter}
      activeColorFilter={colorFilter}
      activeCmcFilter={cmcFilter}
      onFilterByType={(type) => { setTypeFilter(type); if (type !== null) setMobileTab('cards') }}
      onFilterByColor={(color) => { setColorFilter(color); if (color !== null) setMobileTab('cards') }}
      onFilterByCmc={(cmc) => { setCmcFilter(cmc); if (cmc !== null) setMobileTab('cards') }}
    />
  )

  return (
    <div className="relative">
      {ambientGradient && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-[var(--duration-dramatic)]"
          style={{ background: ambientGradient }}
        />
      )}

      {/* ========== MOBILE LAYOUT (< lg) ========== */}
      <div className="lg:hidden">
        <Tabs
          className="mb-6"
          value={mobileTab}
          onChange={(id) => setMobileTab(id as MobileTab)}
          items={[
            { id: 'cards', label: t('deck.paneCards'), panelId: 'deck-tabpanel-cards' },
            { id: 'chat', label: t('deck.paneChat'), panelId: 'deck-tabpanel-chat' },
            { id: 'stats', label: t('deck.paneStats'), panelId: 'deck-tabpanel-stats' },
          ]}
        />

        {mobileTab === 'cards' && (
          <div id="deck-tabpanel-cards" role="tabpanel" aria-labelledby="tab-cards" className="space-y-4">
            {searchRow}
            {cardGridContent}
          </div>
        )}

        {mobileTab === 'chat' && (
          <div
            id="deck-tabpanel-chat"
            role="tabpanel"
            aria-labelledby="tab-chat"
            className="border border-hairline bg-ash-800/40"
            style={{ height: 'calc(100dvh - 240px)' }}
          >
            <AiChat
              messages={chat.messages}
              pending={chat.pending}
              onSend={chat.sendMessage}
              onApply={chat.onApply}
              onDiscard={chat.onDiscard}
              isLoading={chat.isLoading}
              quickActions={quickActions}
            />
          </div>
        )}

        {mobileTab === 'stats' && (
          <div id="deck-tabpanel-stats" role="tabpanel" aria-labelledby="tab-stats" className="space-y-4">
            {balancePane}
            {cardListSlot}
          </div>
        )}
      </div>

      {/* ========== DESKTOP LAYOUT (>= lg) ========== */}
      <div ref={desktopGridRef} className="hidden lg:grid lg:grid-cols-12 lg:gap-4" style={{ height: desktopGridHeight }}>
        {/* Left: AI Chat */}
        <div className="flex min-h-0 flex-col lg:col-span-3">
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneChat')}
          </span>
          <div className="min-h-0 flex-1 border border-hairline bg-ash-800/40">
            <AiChat
              messages={chat.messages}
              pending={chat.pending}
              onSend={chat.sendMessage}
              onApply={chat.onApply}
              onDiscard={chat.onDiscard}
              isLoading={chat.isLoading}
              quickActions={quickActions}
            />
          </div>
        </div>

        {/* Center: Card grid with search */}
        <div className="flex min-h-0 flex-col lg:col-span-6">
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneCards')}
          </span>
          <div className="mb-3">{searchRow}</div>
          <div className="min-h-0 flex-1 overflow-y-auto border border-hairline bg-ash-800/40 p-4">
            {cardGridContent}
          </div>
        </div>

        {/* Right: Balance advisor [+ card list rail] */}
        <div className="flex min-h-0 flex-col lg:col-span-3">
          <span className="mb-2 font-mono text-mono-label uppercase tracking-mono-label text-cream-300">
            {t('deck.paneBalance')}
          </span>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {balancePane}
            {cardListSlot}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && allScryfallCards.length > 0 && (
        <CardLightbox
          cards={allScryfallCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          renderActions={editing || renderExtraLightboxActions ? renderLightboxActions : undefined}
        />
      )}

      <ConfirmModal
        open={pendingRemoveId !== null}
        title={t('confirm.removeCardTitle')}
        body={t('confirm.removeCardBody', {
          name: pendingRemoveId
            ? (cardDataMap.get(pendingRemoveId) ? getCardName(cardDataMap.get(pendingRemoveId)!) : pendingRemoveId)
            : '',
        })}
        confirmLabel={t('confirm.removeCardConfirm')}
        cancelLabel={t('confirm.cancel')}
        onConfirm={confirmRemoveCard}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  )
}
