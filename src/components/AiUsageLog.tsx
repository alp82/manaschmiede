import { useState, useCallback } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

interface LlmLog {
  _id: string
  _creationTime: number
  status: 'pending' | 'complete' | 'error'
  action: string
  provider: string
  model: string
  systemPrompt: string
  inputMessages: Array<{ role: string; content: string }>
  outputText?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  estimatedCostUsd?: number
  error?: string
}

interface Stats {
  totalCalls: number
  pendingCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalDurationMs: number
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>
  byAction: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }>
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function modelShortName(model: string): string {
  if (model.includes('haiku')) return 'haiku'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('opus')) return 'opus'
  return model.split('-')[0]
}

function LogEntry({ log }: { log: LlmLog }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-ash-800"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-200">
            {log.action}
          </span>
          <span className="font-mono text-mono-marginal tracking-mono-marginal text-cream-500">
            {formatTime(log._creationTime)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-3 font-mono text-mono-marginal tracking-mono-marginal text-cream-400">
          <span>{modelShortName(log.model)}</span>
          {log.status === 'pending' && (
            <span className="text-cream-500 animate-pulse">pending...</span>
          )}
          {log.status !== 'pending' && (
            <>
              <span>{formatTokens((log.inputTokens ?? 0) + (log.outputTokens ?? 0))} tok</span>
              <span>{formatCost(log.estimatedCostUsd ?? 0)}</span>
              <span>{formatDuration(log.durationMs ?? 0)}</span>
            </>
          )}
          {log.status === 'error' && <span className="text-ink-red">FAILED</span>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-hairline px-4 py-3">
          <div className="mb-3">
            <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 mb-1">
              SYSTEM PROMPT
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-cream-400">
              {log.systemPrompt}
            </pre>
          </div>

          {log.inputMessages.map((msg, i) => (
            <div key={i} className="mb-3">
              <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 mb-1">
                {msg.role}
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-cream-300">
                {msg.content}
              </pre>
            </div>
          ))}

          {log.outputText && (
            <div className="mb-3">
              <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 mb-1">
                OUTPUT
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-cream-200">
                {log.outputText}
              </pre>
            </div>
          )}

          {log.status === 'pending' && (
            <div className="py-2 font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 animate-pulse">
              Waiting for response...
            </div>
          )}

          {log.error && (
            <div>
              <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-ink-red mb-1">
                ERROR
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-red">
                {log.error}
              </pre>
            </div>
          )}

          {log.status !== 'pending' && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-mono-marginal tracking-mono-marginal text-cream-500">
              <span>in: {formatTokens(log.inputTokens ?? 0)}</span>
              <span>out: {formatTokens(log.outputTokens ?? 0)}</span>
              <span>{log.model}</span>
              <span>{log.provider}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
        {label}
      </span>
      <span className="font-mono text-mono-label tracking-mono-label text-cream-200">
        {value}
      </span>
    </div>
  )
}

const STORAGE_KEY = 'manaschmiede-ai-log-open'

function usePersistedOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpenRaw] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const setOpen = useCallback((v: boolean) => {
    setOpenRaw(v)
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch { /* noop */ }
  }, [])
  return [open, setOpen]
}

export function AiUsageLog() {
  const [open, setOpen] = usePersistedOpen()
  const logs = useQuery(api.llmUsageLogs.list, open ? { limit: 100 } : 'skip') as LlmLog[] | undefined
  const stats = useQuery(api.llmUsageLogs.stats, open ? {} : 'skip') as Stats | undefined

  return (
    <>
      {/* Edge tab — always visible, pinned to right edge */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={
          'fixed right-0 top-1/2 z-40 -translate-y-1/2 cursor-pointer ' +
          'border border-r-0 border-hairline bg-ash-900 px-1 py-3 ' +
          'font-mono text-mono-marginal uppercase tracking-mono-marginal ' +
          'transition-colors hover:bg-ash-800 hover:text-cream-100 ' +
          (open ? 'text-cream-200' : 'text-cream-500')
        }
        style={{ writingMode: 'vertical-rl' }}
        aria-pressed={open}
        title={open ? 'Close AI log' : 'Open AI log'}
      >
        {open ? '▸ AI' : '◂ AI'}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-30 flex w-[420px] flex-col border-l border-hairline bg-ash-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <span className="font-display text-display-eyebrow uppercase leading-none tracking-eyebrow text-cream-100">
              AI Usage
            </span>
          </div>

          {/* Stats */}
          {stats && (
            <div className="border-b border-hairline px-4 py-3">
              <StatRow label="Calls" value={stats.pendingCalls > 0 ? `${stats.totalCalls} (${stats.pendingCalls} pending)` : String(stats.totalCalls)} />
              <StatRow label="Input tokens" value={formatTokens(stats.totalInputTokens)} />
              <StatRow label="Output tokens" value={formatTokens(stats.totalOutputTokens)} />
              <StatRow label="Total cost" value={formatCost(stats.totalCostUsd)} />
              <StatRow label="Total time" value={formatDuration(stats.totalDurationMs)} />

              {Object.keys(stats.byModel).length > 0 && (
                <div className="mt-2 border-t border-hairline pt-2">
                  <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 mb-1">
                    By model
                  </div>
                  {Object.entries(stats.byModel).map(([model, data]) => (
                    <div key={model} className="flex items-baseline justify-between py-0.5">
                      <span className="font-mono text-mono-marginal tracking-mono-marginal text-cream-400">
                        {modelShortName(model)}
                      </span>
                      <span className="font-mono text-mono-marginal tracking-mono-marginal text-cream-300">
                        {data.calls}× · {formatTokens(data.inputTokens + data.outputTokens)} tok · {formatCost(data.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {Object.keys(stats.byAction).length > 0 && (
                <div className="mt-2 border-t border-hairline pt-2">
                  <div className="font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500 mb-1">
                    By action
                  </div>
                  {Object.entries(stats.byAction).map(([action, data]) => (
                    <div key={action} className="flex items-baseline justify-between py-0.5">
                      <span className="font-mono text-mono-marginal tracking-mono-marginal text-cream-400">
                        {action}
                      </span>
                      <span className="font-mono text-mono-marginal tracking-mono-marginal text-cream-300">
                        {data.calls}× · {formatCost(data.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Log entries */}
          <div className="flex-1 overflow-y-auto">
            {logs === undefined && (
              <div className="px-4 py-8 text-center font-mono text-mono-label uppercase tracking-mono-label text-cream-500">
                Loading...
              </div>
            )}
            {logs !== undefined && logs.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-mono-label uppercase tracking-mono-label text-cream-500">
                No calls logged yet
              </div>
            )}
            {logs?.map((log) => (
              <LogEntry key={log._id} log={log} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
