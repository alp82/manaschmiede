import { useState, useRef, useEffect } from 'react'
import type { ChatMessage, PendingChanges } from '../lib/useDeckChat'
import { useT } from '../lib/i18n'

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

export function AiChat({ messages, pending, onSend, onApply, onDiscard, isLoading, quickActions }: AiChatProps) {
  const t = useT()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

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
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-surface-700 bg-surface-800/50">
      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && !pending && (
          <p className="py-8 text-center text-sm text-surface-500">
            {t('chat.emptyPrompt')}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'ml-4 bg-accent/20 text-surface-100'
                : 'mr-4 bg-surface-700/50 text-surface-300'
            }`}
          >
            {msg.content}
            {/* Inline change preview for applied/discarded changes */}
            {msg.changes && msg.changes.length > 0 && (
              <div className={`mt-2 space-y-0.5 border-t pt-2 ${
                msg.changesApplied ? 'border-mana-green/30' : 'border-surface-600'
              }`}>
                <span className={`text-[10px] font-medium ${
                  msg.changesApplied ? 'text-mana-green' : 'text-surface-500'
                }`}>
                  {msg.changesApplied ? '\u2713 Applied' : '\u2717 Discarded'}
                </span>
                {msg.changes.map((ch) => (
                  <div key={ch.scryfallId} className="flex items-center gap-2 text-xs">
                    {ch.type === 'added' && (
                      <>
                        <span className="font-bold text-mana-green">+</span>
                        <span className="text-surface-300">{ch.newQuantity}x {ch.name}</span>
                      </>
                    )}
                    {ch.type === 'removed' && (
                      <>
                        <span className="font-bold text-mana-red">-</span>
                        <span className="text-surface-500 line-through">{ch.oldQuantity}x {ch.name}</span>
                      </>
                    )}
                    {ch.type === 'changed' && (
                      <>
                        <span className="font-bold text-mana-multi">~</span>
                        <span className="text-surface-300">
                          {ch.name}: {ch.oldQuantity} &#8594; {ch.newQuantity}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="mr-4 flex items-center gap-2 rounded-lg bg-surface-700/50 px-3 py-2">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Pending changes preview */}
        {pending && (
          <div className="mr-2 space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-accent">{pending.deckName}</p>
              <span className={`text-[10px] font-bold ${
                pending.resolvedCards.reduce((s, c) => s + c.quantity, 0) === 60
                  ? 'text-mana-green'
                  : 'text-mana-red'
              }`}>
                {pending.resolvedCards.reduce((s, c) => s + c.quantity, 0)} cards
              </span>
            </div>
            <p className="text-xs text-surface-400">{pending.description}</p>

            {/* Change list */}
            <div className="space-y-0.5">
              {pending.changes.map((ch) => (
                <div key={ch.scryfallId} className="flex items-center gap-2 text-xs">
                  {ch.type === 'added' && (
                    <>
                      <span className="font-bold text-mana-green">+</span>
                      <span className="text-surface-200">{ch.newQuantity}x {ch.name}</span>
                    </>
                  )}
                  {ch.type === 'removed' && (
                    <>
                      <span className="font-bold text-mana-red">-</span>
                      <span className="text-surface-400 line-through">{ch.oldQuantity}x {ch.name}</span>
                    </>
                  )}
                  {ch.type === 'changed' && (
                    <>
                      <span className="font-bold text-mana-multi">~</span>
                      <span className="text-surface-200">
                        {ch.name}: {ch.oldQuantity} &#8594; {ch.newQuantity}
                      </span>
                    </>
                  )}
                </div>
              ))}
              {pending.changes.length === 0 && (
                <p className="text-xs text-surface-500">{t('chat.noChanges')}</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onApply}
                className="rounded bg-mana-green/20 px-3 py-1 text-xs font-medium text-mana-green transition-colors hover:bg-mana-green/30"
              >
                {t('chat.apply')}
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="rounded bg-surface-700 px-3 py-1 text-xs text-surface-400 transition-colors hover:bg-surface-600"
              >
                {t('chat.discard')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick action chips + Input */}
      <div className="flex-shrink-0 border-t border-surface-700 p-2">
        {quickActions && quickActions.length > 0 && !isLoading && !pending && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => onSend(action.message)}
                className="rounded-full border border-surface-600 bg-surface-800 px-3 py-1 text-xs text-surface-400 transition-colors hover:border-accent hover:text-accent"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={pending ? t('chat.inputPending') : t('chat.inputPlaceholder')}
            disabled={isLoading}
            className="flex-1 rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
