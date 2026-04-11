import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, PendingChanges, CardChange } from '../lib/useDeckChat'
import type { ScryfallCard } from '../lib/scryfall/types'
import { getCardImageUri } from '../lib/scryfall/types'
import { CardLightbox } from './CardLightbox'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { LoadingDots } from './ui/LoadingDots'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useDeckSounds } from '../lib/sounds'

export interface QuickAction {
  label: string
  message: string
}

interface AiChatProps {
  messages: ChatMessage[]
  pending: PendingChanges | null
  onSend: (message: string) => void
  onApply: () => void
  onDiscard: () => void
  isLoading: boolean
  quickActions?: QuickAction[]
}

/**
 * Specimen AiChat — epistolary treatment.
 *
 * User messages: JetBrains Mono, preceded by `USER —` marginal header.
 * AI messages: body face (Geist), preceded by `MANASCHMIEDE —` marginal
 * header. Exchanges are separated by a `§` ornamental rule rather than
 * bubbles — feels like a correspondence in a printed book.
 *
 * Input: mono textarea with bottom hairline only. Send is a Button.
 * Pending change previews live inside a hairline-framed ledger block.
 */

function ChangeItem({ ch, onClick }: { ch: CardChange; onClick?: () => void }) {
  const thumb = ch.scryfallCard ? getCardImageUri(ch.scryfallCard, 'small') : null

  const glyph =
    ch.type === 'added' ? '+' : ch.type === 'removed' ? '\u2212' : '\u223C'
  const glyphColor =
    ch.type === 'added'
      ? 'text-cream-100'
      : ch.type === 'removed'
        ? 'text-ink-red-bright'
        : 'text-cream-300'

  // Color-code the quantity delta for changed rows: increase reads as
  // cream-bright (additive), decrease as ink-red (subtractive), mirroring
  // the +/− glyph colors at the row level.
  const qtyDelta =
    ch.type === 'changed' ? ch.newQuantity - ch.oldQuantity : 0
  const qtyColor =
    qtyDelta > 0
      ? 'text-cream-100'
      : qtyDelta < 0
        ? 'text-ink-red-bright'
        : 'text-cream-300'

  const nameClass =
    ch.type === 'removed' ? 'text-cream-500 line-through' : 'text-cream-200'

  const body =
    ch.type === 'added' ? (
      <span className={cn('font-mono text-mono-tag', nameClass)}>
        {ch.newQuantity}× {ch.name}
      </span>
    ) : ch.type === 'removed' ? (
      <span className={cn('font-mono text-mono-tag', nameClass)}>
        {ch.oldQuantity}× {ch.name}
      </span>
    ) : (
      <span className={cn('font-mono text-mono-tag', nameClass)}>
        {ch.name}:{' '}
        <span className={cn('whitespace-nowrap tabular-nums', qtyColor)}>
          {ch.oldQuantity} → {ch.newQuantity}
        </span>
      </span>
    )

  const content = (
    <>
      <span
        className={cn(
          'w-3 flex-shrink-0 text-center font-mono text-mono-label font-bold',
          glyphColor,
        )}
      >
        {glyph}
      </span>
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="h-14 w-10 flex-shrink-0 border border-hairline object-cover transition-colors group-hover:border-cream-200"
        />
      ) : (
        <span className="h-14 w-10 flex-shrink-0 border border-hairline bg-ash-800" />
      )}
      <span className="min-w-0 flex-1 leading-snug">{body}</span>
    </>
  )

  if (!thumb || !onClick) {
    return <div className="flex items-center gap-3 py-1">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3 px-1 py-1 text-left transition-colors hover:bg-ash-800/60"
    >
      {content}
    </button>
  )
}

export function AiChat({
  messages,
  pending,
  onSend,
  onApply,
  onDiscard,
  isLoading,
  quickActions,
}: AiChatProps) {
  const t = useT()
  const sounds = useDeckSounds()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lightboxCards, setLightboxCards] = useState<ScryfallCard[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const openCardLightbox = useCallback((card: ScryfallCard, allCards: ScryfallCard[]) => {
    setLightboxCards(allCards)
    const idx = allCards.findIndex((c) => c.id === card.id)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading, pending])

  function handleSubmit() {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    onSend(text)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-6">
        {messages.length === 0 && !pending && (
          // TODO: migrate to <EmptyState> — current sidebar style is a single
          // italic prompt line without a Cinzel title, which would be too
          // loud for the compact chat pane.
          <p className="py-8 text-center font-body text-sm italic text-cream-500">
            {t('chat.emptyPrompt')}
          </p>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const prev = messages[i - 1]
          const showDivider = i > 0 && prev && prev.role !== msg.role
          return (
            <div key={i}>
              {showDivider && (
                <div
                  className="mb-8 flex items-center justify-center gap-3"
                  aria-hidden="true"
                >
                  <span className="h-px w-10 bg-hairline" />
                  <span className="font-mono text-mono-marginal text-cream-500">
                    {'\u00A7'}
                  </span>
                  <span className="h-px w-10 bg-hairline" />
                </div>
              )}
              <div>
                {/* Marginal sender header */}
                <p className="mb-2 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
                  {isUser ? 'User \u2014' : 'Manaschmiede \u2014'}
                </p>

                {/* Message body */}
                <p
                  className={cn(
                    'whitespace-pre-wrap leading-relaxed',
                    isUser
                      ? 'font-mono text-mono-label uppercase tracking-mono-label text-cream-100'
                      : 'font-body text-sm text-cream-200',
                  )}
                >
                  {msg.content}
                </p>

                {/* Inline change summary for applied/discarded */}
                {msg.changes && msg.changes.length > 0 && (
                  <div
                    className={cn(
                      'mt-3 border-l-2 pl-3',
                      msg.changesApplied ? 'border-cream-300' : 'border-ink-red',
                    )}
                  >
                    <span
                      className={cn(
                        'font-mono text-mono-marginal uppercase tracking-mono-marginal',
                        msg.changesApplied ? 'text-cream-300' : 'text-ink-red-bright',
                      )}
                    >
                      {msg.changesApplied ? 'Applied' : 'Discarded'}
                    </span>
                    <div className="mt-1.5 space-y-0.5">
                      {(() => {
                        const allCards = msg.changes!
                          .filter((c) => c.scryfallCard)
                          .map((c) => c.scryfallCard!)
                        return msg.changes!.map((ch) => (
                          <ChangeItem
                            key={ch.scryfallId}
                            ch={ch}
                            onClick={
                              ch.scryfallCard
                                ? () => openCardLightbox(ch.scryfallCard!, allCards)
                                : undefined
                            }
                          />
                        ))
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Loading — marching squares */}
        {isLoading && (
          <div>
            <p className="mb-2 font-mono text-mono-marginal uppercase leading-none tracking-mono-marginal text-cream-500">
              Manaschmiede &mdash;
            </p>
            <LoadingDots size="sm" tone="muted" />
          </div>
        )}

        {/* Pending changes ledger */}
        {pending && (
          <div className="border border-ink-red bg-ash-800/40 p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="font-mono text-mono-label uppercase tracking-mono-label text-cream-100">
                {t('chat.cardSwap')}
              </p>
              {(() => {
                const added = pending.changes
                  .filter((c) => c.type === 'added')
                  .reduce((s, c) => s + c.newQuantity, 0)
                const removed = pending.changes
                  .filter((c) => c.type === 'removed')
                  .reduce((s, c) => s + c.oldQuantity, 0)
                const changed = pending.changes.filter((c) => c.type === 'changed').length
                const parts: string[] = []
                if (added > 0) parts.push(`+${added}`)
                if (removed > 0) parts.push(`\u2212${removed}`)
                if (changed > 0) parts.push(`\u223C${changed}`)
                return parts.length > 0 ? (
                  <span className="flex-shrink-0 whitespace-nowrap font-mono text-mono-tag tabular-nums tracking-mono-tag text-cream-300">
                    {parts.join(' / ')}
                  </span>
                ) : (
                  <span className="flex-shrink-0 whitespace-nowrap font-mono text-mono-tag tabular-nums tracking-mono-tag text-cream-500">
                    {t('chat.noChanges')}
                  </span>
                )
              })()}
            </div>
            <p className="mb-3 font-body text-sm italic text-cream-300">
              {pending.explanation ?? pending.description}
            </p>

            {/* Change list */}
            <div className="space-y-0.5 border-t border-hairline pt-3">
              {(() => {
                const allCards = pending.changes
                  .filter((c) => c.scryfallCard)
                  .map((c) => c.scryfallCard!)
                return pending.changes.map((ch) => (
                  <ChangeItem
                    key={ch.scryfallId}
                    ch={ch}
                    onClick={
                      ch.scryfallCard ? () => openCardLightbox(ch.scryfallCard!, allCards) : undefined
                    }
                  />
                ))
              })()}
              {pending.changes.length === 0 && (
                <p className="font-mono text-mono-tag uppercase tracking-mono-tag text-cream-500">
                  {t('chat.noChanges')}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="sm" onClick={onApply}>
                {t('chat.apply')}
              </Button>
              <Button variant="secondary" size="sm" onClick={onDiscard}>
                {t('chat.discard')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Quick action chips + Input */}
      <div className="flex-shrink-0 border-t border-hairline px-5 py-4">
        {quickActions && quickActions.length > 0 && !isLoading && !pending && (
          <div className="mb-3 flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Pill key={action.label} size="sm" onClick={() => onSend(action.message)}>
                {action.label}
              </Pill>
            ))}
          </div>
        )}
        <div className="flex flex-col border border-hairline-strong bg-ash-800 px-3 py-2 transition-colors focus-within:border-cream-200">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              } else if (e.key.length === 1) {
                sounds.typing()
              }
            }}
            placeholder={pending ? t('chat.inputPending') : t('chat.inputPlaceholder')}
            disabled={isLoading}
            rows={2}
            className="w-full resize-none bg-transparent font-mono text-mono-label text-cream-100 placeholder-cream-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <span
              aria-hidden="true"
              className="hidden font-mono text-mono-tag text-cream-500 sm:inline"
            >
              {'\u21B5'}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
            >
              {t('chat.send')}
            </Button>
          </div>
        </div>
      </div>

      {lightboxIndex !== null && lightboxCards.length > 0 && (
        <CardLightbox
          cards={lightboxCards}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  )
}
