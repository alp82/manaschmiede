/**
 * The bench board (#57, #65): the repo's blind review surface for choosing
 * models by evidence.
 *
 * Working mode. Top to bottom: the site and reveal chrome; the scenarios for
 * that site, seeded from real `llmUsageLogs` prompts; the scenario strip
 * (mana symbols, archetype pills, one-line idea, full prompt behind a
 * toggle); the candidate slate to fan out; the scoreboard, one row per blind
 * run with the gate verdict anchored before the reviewer's rank; and the
 * table, two candidates as rows of card art with the lightbox. Model identity
 * is hidden until SHOWN. Every run and rank persists in Convex.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import {
  BENCH_SITES,
  benchFirstCandidates,
  blindLabels,
  type BenchCandidate,
  type BenchSite,
} from '../../convex/lib/benchScenario'
import { CALLS_PER_BUILD, MAX_PROJECTED_BUILD_COST_USD, SITE_TEMPO } from '../../convex/lib/mechanicalGate'
import { parseComboResponse, parseDeckResponse, parseSectionResponse } from '../../convex/lib/responseShapes'
import type { GatewayModel } from '../../convex/lib/gatewayShapes'
import { Layout } from '../components/Layout'
import { CardLightbox } from '../components/CardLightbox'
import { ManaSymbol } from '../components/ManaSymbol'
import { Button } from '../components/ui/Button'
import { LoadingDots } from '../components/ui/LoadingDots'
import { Pill } from '../components/ui/Pill'
import { useToast } from '../components/ui/Toast'
import { isManaColor } from '../lib/mana-colors'
import { getCardsByNames } from '../lib/scryfall/client'
import { getCardImageUri, type ScryfallCard } from '../lib/scryfall/types'
import { cn } from '../lib/utils'

/** The product ceilings the bars turn ink-red over; the gate's hard limits are double these. */
const PRODUCT_LATENCY_MS = { deck: 60_000, mechanical: 5_000 } as const
const EFFORTS = ['default', 'none', 'low', 'medium', 'high'] as const
const RUN_COUNTS = [1, 3, 5] as const

type Run = Doc<'benchRuns'>
type Scenario = Doc<'benchScenarios'>

export const Route = createFileRoute('/bench')({
  validateSearch: (s: Record<string, unknown>) => ({
    site: (BENCH_SITES as readonly string[]).includes(String(s.site)) ? (s.site as BenchSite) : 'suggestCombos',
    scenario: typeof s.scenario === 'string' ? s.scenario : undefined,
  }),
  component: BenchPage,
})

// ── Reading a run for the table ─────────────────────────────────────────────

interface Shown {
  combos: Array<{ name: string; cards: string[]; explanation: string }>
  cards: Array<{ name: string; quantity: number }>
  prose: string
}

function readRun(site: BenchSite, text: string | undefined): Shown {
  const empty: Shown = { combos: [], cards: [], prose: '' }
  if (!text) return empty
  try {
    if (site === 'suggestCombos') return { ...empty, combos: parseComboResponse(text).combos }
    if (site === 'fillSection') {
      const r = parseSectionResponse(text)
      return { ...empty, cards: r.cards, prose: r.explanation }
    }
    const d = parseDeckResponse(text)
    return { ...empty, cards: d.cards, prose: [d.name, d.description, d.explanation].filter(Boolean).join(' — ') }
  } catch {
    return empty
  }
}

function runNames(shown: Shown): string[] {
  return [...shown.cards.map((c) => c.name), ...shown.combos.flatMap((c) => c.cards)]
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500', className)}>
      {children}
    </span>
  )
}

function Rule({ heavy }: { heavy?: boolean }) {
  return <div className={cn('mt-6 border-t', heavy ? 'border-cream-500' : 'border-hairline')} />
}

function Bar({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <span className="inline-block h-[6px] w-20 align-middle bg-ash-700">
      <span className={cn('block h-full', over ? 'bg-ink-red' : 'bg-cream-300')} style={{ width: `${pct}%` }} />
    </span>
  )
}

function useCardArt(names: string[]) {
  const [art, setArt] = useState<Record<string, ScryfallCard>>({})
  const key = names.join('|')
  useEffect(() => {
    const missing = [...new Set(names)].filter((n) => !art[n.toLowerCase()])
    if (missing.length === 0) return
    let cancelled = false
    getCardsByNames(missing)
      .then((cards) => {
        if (cancelled) return
        const found: Record<string, ScryfallCard> = {}
        for (const c of cards) {
          found[c.name.toLowerCase()] = c
          found[c.name.split(' // ')[0].toLowerCase()] = c
        }
        setArt((a) => ({ ...a, ...found }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return art
}

function CardArt({
  name,
  card,
  missing,
  quantity,
  onOpen,
}: {
  name: string
  card?: ScryfallCard
  missing?: boolean
  quantity?: number
  onOpen?: (card: ScryfallCard) => void
}) {
  const uri = card ? getCardImageUri(card, 'small') : undefined
  return (
    <figure className={cn('relative w-[104px] shrink-0', missing && 'outline outline-1 outline-ink-red')}>
      {uri ? (
        <img
          src={uri}
          alt={name}
          className="block w-full cursor-pointer transition-transform hover:-translate-y-1"
          onClick={() => card && onOpen?.(card)}
        />
      ) : (
        <div className="flex aspect-[5/7] w-full items-end bg-ash-800 p-1 font-mono text-[10px] text-cream-400">
          {missing ? `✗ ${name}` : name}
        </div>
      )}
      {quantity !== undefined && (
        <span className="absolute left-0 top-0 bg-ash-900 px-1 font-mono text-[11px] text-cream-100">{quantity}×</span>
      )}
    </figure>
  )
}

// ── Candidate slate ─────────────────────────────────────────────────────────

interface SlateRow extends BenchCandidate {
  on: boolean
}

function CandidateSlate({
  site,
  rows,
  setRows,
  models,
  onCheck,
  checking,
}: {
  site: BenchSite
  rows: SlateRow[]
  setRows: (rows: SlateRow[]) => void
  models: Record<string, GatewayModel> | null
  onCheck: () => void
  checking: boolean
}) {
  const update = (i: number, patch: Partial<SlateRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const effortOf = (r: SlateRow) => (r.reasoning === undefined ? 'default' : r.reasoning === 'off' ? 'none' : 'effort' in r.reasoning ? r.reasoning.effort : 'default')
  const setEffort = (i: number, effort: string) =>
    update(i, { reasoning: effort === 'default' ? undefined : effort === 'none' ? 'off' : { effort } })

  return (
    <div>
      <div className="flex items-baseline gap-4">
        <Mono>candidates · {site}</Mono>
        <Pill size="sm" variant="ghost" onClick={onCheck} disabled={checking}>
          {checking ? 'checking…' : models ? 'slate checked' : 'check slate against gateway'}
        </Pill>
      </div>
      <table className="mt-2 w-full font-mono text-mono-label tabular-nums">
        <thead>
          <tr className="text-left text-cream-500">
            <th className="py-1 pr-3 font-normal">ON</th>
            <th className="pr-3 font-normal">MODEL</th>
            <th className="pr-3 font-normal">HOST</th>
            <th className="pr-3 font-normal">JSON</th>
            <th className="pr-3 font-normal">EFFORT</th>
            <th className="font-normal">MAX TOKENS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const known = models ? models[r.model] : undefined
            const missing = models !== null && !known
            const efforts = known?.reasoning?.supportedEfforts
            return (
              <tr key={r.model} className={cn('border-t border-hairline/20 text-cream-200', !r.on && 'opacity-40')}>
                <td className="py-1.5 pr-3">
                  <Pill size="sm" selected={r.on} onClick={() => update(i, { on: !r.on })}>
                    {r.on ? 'on' : 'off'}
                  </Pill>
                </td>
                <td className="pr-3">
                  <span className={cn(missing && 'text-ink-red')}>{r.model}</span>
                  {missing && <Mono className="ml-2 text-ink-red">not on gateway</Mono>}
                  {known?.reasoning?.mandatory && <Mono className="ml-2">reasoning mandatory</Mono>}
                </td>
                <td className="pr-3">
                  <input
                    value={r.provider ?? ''}
                    placeholder="any"
                    onChange={(e) => update(i, { provider: e.target.value || undefined })}
                    className="w-24 border-b border-hairline bg-transparent font-mono text-mono-label text-cream-200 placeholder:italic placeholder:text-cream-500 focus:border-cream-200 focus:outline-none"
                  />
                </td>
                <td className="pr-3">
                  <div className="flex gap-1">
                    {(['json_schema', 'json_object', 'none'] as const).map((m) => (
                      <Pill key={m} size="sm" selected={r.structured === m} onClick={() => update(i, { structured: m })}>
                        {m === 'json_schema' ? 'schema' : m === 'json_object' ? 'object' : 'none'}
                      </Pill>
                    ))}
                  </div>
                </td>
                <td className="pr-3">
                  <div className="flex gap-1">
                    {EFFORTS.map((e) => {
                      const unsupported = efforts !== undefined && e !== 'default' && !efforts.includes(e)
                      return (
                        <Pill
                          key={e}
                          size="sm"
                          selected={effortOf(r) === e}
                          disabled={unsupported}
                          title={unsupported ? 'not in this model\'s effort list' : undefined}
                          onClick={() => setEffort(i, e)}
                        >
                          {e}
                        </Pill>
                      )
                    })}
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    value={r.maxTokens}
                    onChange={(e) => update(i, { maxTokens: Math.max(256, Number(e.target.value) || 256) })}
                    className="w-20 border-b border-hairline bg-transparent font-mono text-mono-label text-cream-200 focus:border-cream-200 focus:outline-none"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Scoreboard ──────────────────────────────────────────────────────────────

function gateCell(run: Run) {
  if (run.status === 'pending') return <LoadingDots size="sm" tone="muted" />
  if (run.status === 'error') return <span className="text-ink-red">✗ {run.failure ?? 'error'} · {run.error}</span>
  if (run.gateHardFail) return <span className="text-ink-red">✗ {run.gateHardFail}</span>
  return <span className="text-cream-300">✓ pass</span>
}

function Scoreboard({
  site,
  runs,
  labels,
  reveal,
  picked,
  onPick,
  onRank,
}: {
  site: BenchSite
  runs: Run[]
  labels: Map<string, string>
  reveal: boolean
  picked: string[]
  onPick: (id: string) => void
  onRank: (id: Id<'benchRuns'>, rank: number | null) => void
}) {
  const n = runs.length
  const max = {
    lat: Math.max(...runs.map((r) => r.durationMs ?? 0), 1),
    cost: Math.max(...runs.map((r) => r.costUsd ?? 0), 0.0001),
    out: Math.max(...runs.map((r) => r.outputTokens ?? 0), 1),
    think: Math.max(...runs.map((r) => r.reasoningTokens ?? 0), 1),
  }
  const latencyCeiling = PRODUCT_LATENCY_MS[SITE_TEMPO[site]]
  const sorted = [...runs].sort((a, b) => (labels.get(a._id) ?? '').localeCompare(labels.get(b._id) ?? ''))

  return (
    <table className="mt-2 w-full font-mono text-mono-label tabular-nums">
      <thead>
        <tr className="text-left text-cream-500">
          <th className="w-8 py-1 font-normal" />
          <th className="py-1 pr-4 font-normal">GATE</th>
          <th className="pr-4 font-normal">LATENCY</th>
          <th className="pr-4 font-normal">COST / BUILD</th>
          <th className="pr-4 font-normal">OUTPUT</th>
          <th className="pr-4 font-normal">REASONING</th>
          <th className="pr-4 font-normal">RUNG</th>
          <th className="pr-4 font-normal">YOUR RANK</th>
          <th className="font-normal">MODEL</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const on = picked.includes(r._id)
          const failed = r.status === 'error' || !!r.gateHardFail
          const build = (r.costUsd ?? 0) * CALLS_PER_BUILD[site]
          const rung = r.gateScores?.rung
          return (
            <tr
              key={r._id}
              onClick={() => onPick(r._id)}
              className={cn(
                'cursor-pointer border-t border-hairline/20 text-cream-200 hover:bg-ash-800',
                on && 'border-l-2 border-l-ink-red bg-ash-800',
                failed && !on && 'opacity-50',
              )}
            >
              <td className="py-2 pl-2 font-display text-display-eyebrow text-cream-100">{labels.get(r._id)}</td>
              <td className="max-w-[18rem] pr-4">{gateCell(r)}</td>
              <td className="pr-4 whitespace-nowrap">
                <Bar value={r.durationMs ?? 0} max={max.lat} over={(r.durationMs ?? 0) > latencyCeiling} />
                <span className="ml-2 text-cream-400">{((r.durationMs ?? 0) / 1000).toFixed(1)}s</span>
              </td>
              <td className="pr-4 whitespace-nowrap">
                <Bar value={r.costUsd ?? 0} max={max.cost} over={build > MAX_PROJECTED_BUILD_COST_USD} />
                <span className="ml-2 text-cream-400">
                  {((r.costUsd ?? 0) * 100).toFixed(2)}¢ / {(build * 100).toFixed(1)}¢
                </span>
              </td>
              <td className="pr-4 whitespace-nowrap">
                <Bar value={r.outputTokens ?? 0} max={max.out} />
                <span className="ml-2 text-cream-400">{r.outputTokens ?? 0}</span>
              </td>
              <td className="pr-4 whitespace-nowrap">
                <Bar value={r.reasoningTokens ?? 0} max={max.think} />
                <span className="ml-2 text-cream-400">{r.reasoningTokens ?? 0}</span>
              </td>
              <td className="pr-4 text-cream-400">
                {r.schemaEnforced ?? '—'}
                {rung ? ` · ${rung}` : ''}
              </td>
              <td className="pr-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-1">
                  {Array.from({ length: n }, (_, i) => i + 1).map((rank) => (
                    <Pill key={rank} size="sm" selected={r.humanRank === rank} onClick={() => onRank(r._id, r.humanRank === rank ? null : rank)}>
                      {rank}
                    </Pill>
                  ))}
                </div>
              </td>
              <td className="whitespace-nowrap text-cream-500">
                {reveal ? `${r.model}${r.effort ? ` · ${r.effort}` : ''}${r.providerAnswered ? ` · ${r.providerAnswered}` : ''}` : '████████'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── The table: two candidates as card art ───────────────────────────────────

function OnTable({
  site,
  runs,
  labels,
  reveal,
  why,
}: {
  site: BenchSite
  runs: Run[]
  labels: Map<string, string>
  reveal: boolean
  why: boolean
}) {
  const shown = useMemo(() => runs.map((r) => ({ run: r, shown: readRun(site, r.outputText) })), [runs, site])
  const art = useCardArt(shown.flatMap((s) => runNames(s.shown)))
  const [lightbox, setLightbox] = useState<{ cards: ScryfallCard[]; index: number } | null>(null)
  const open = (group: string[]) => (card: ScryfallCard) => {
    const cards = group.map((n) => art[n.toLowerCase()]).filter(Boolean)
    setLightbox({ cards, index: Math.max(0, cards.indexOf(card)) })
  }

  return (
    <>
      <div className={cn('mt-6 grid gap-8', shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {shown.map(({ run, shown: s }) => {
          const missing = new Set(run.gateScores?.nonexistentCards ?? [])
          const offColor = run.gateScores?.offColorCards ?? []
          const offPool = run.gateScores?.offPoolCards ?? []
          return (
            <section key={run._id} className="border-t-2 border-cream-500 pt-2">
              <div className="flex items-baseline gap-3">
                <span className="font-display text-display-eyebrow uppercase tracking-eyebrow text-cream-100">{labels.get(run._id)}</span>
                <Mono className={reveal ? 'text-cream-300' : undefined}>{reveal ? run.model : '████████'}</Mono>
                {run.stopReason === 'length' && <Mono className="text-ink-red">truncated</Mono>}
              </div>
              {s.combos.length > 0 ? (
                <ol className="mt-3 space-y-4">
                  {s.combos.map((k, i) => (
                    <li key={i}>
                      <div className="flex items-baseline gap-3">
                        <Mono>{String(i + 1).padStart(2, '0')}</Mono>
                        <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-100">{k.name}</span>
                      </div>
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {k.cards.map((nm) => (
                          <CardArt key={nm} name={nm} card={art[nm.toLowerCase()]} missing={missing.has(nm)} onOpen={open(k.cards)} />
                        ))}
                      </div>
                      {why && <p className="mt-2 max-w-prose font-body text-body-small text-cream-300">{k.explanation}</p>}
                    </li>
                  ))}
                </ol>
              ) : s.cards.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.cards.map((c) => (
                    <CardArt
                      key={c.name}
                      name={c.name}
                      quantity={c.quantity}
                      card={art[c.name.toLowerCase()]}
                      missing={missing.has(c.name)}
                      onOpen={open(s.cards.map((x) => x.name))}
                    />
                  ))}
                </div>
              ) : (
                <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-cream-400">
                  {run.outputText || run.error || '(no output)'}
                </pre>
              )}
              {why && s.prose && <p className="mt-3 max-w-prose font-body text-body-small text-cream-300">{s.prose}</p>}
              {(offColor.length > 0 || offPool.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-x-4 font-mono text-mono-marginal tracking-mono-marginal text-cream-400">
                  {offColor.length > 0 && <span>off-color · {offColor.join(', ')}</span>}
                  {offPool.length > 0 && <span>off-pool · {offPool.join(', ')}</span>}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {lightbox && (
        <CardLightbox
          cards={lightbox.cards}
          currentIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox({ ...lightbox, index })}
        />
      )}
    </>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function BenchPage() {
  const { site, scenario: scenarioParam } = Route.useSearch()
  const navigate = useNavigate()
  const toast = useToast()
  const set = (patch: Partial<{ site: BenchSite; scenario: string | undefined }>) =>
    navigate({ to: '/bench', search: { site, scenario: scenarioParam, ...patch }, replace: true })

  const scenarios = useQuery(api.bench.listScenarios) as Scenario[] | undefined
  const forSite = (scenarios ?? []).filter((s) => s.site === site)
  const scenarioId = (scenarioParam && forSite.some((s) => s._id === scenarioParam) ? scenarioParam : forSite[0]?._id) as
    | Id<'benchScenarios'>
    | undefined
  const detail = useQuery(api.bench.getScenario, scenarioId ? { scenarioId } : 'skip')
  const seedable = useQuery(api.bench.listSeedableLogs)
  const seed = useMutation(api.bench.seedScenario)
  const remove = useMutation(api.bench.deleteScenario)
  const rank = useMutation(api.bench.setHumanRank)
  const fanOut = useAction(api.bench.fanOut)
  const gatewayModels = useAction(api.bench.gatewayModels)

  const [reveal, setReveal] = useState(false)
  const [showSeeds, setShowSeeds] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [why, setWhy] = useState(false)
  const [rows, setRows] = useState<SlateRow[]>(() => benchFirstCandidates(site).map((c) => ({ ...c, on: true })))
  const [runCount, setRunCount] = useState<number>(1)
  const [running, setRunning] = useState(false)
  const [models, setModels] = useState<Record<string, GatewayModel> | null>(null)
  const [checking, setChecking] = useState(false)
  const [batch, setBatch] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    setRows(benchFirstCandidates(site).map((c) => ({ ...c, on: true })))
    setBatch(null)
    setPicked([])
  }, [site])

  const runs = (detail?.runs ?? []) as Run[]
  const batches = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of runs) seen.set(r.batchId, Math.max(seen.get(r.batchId) ?? 0, r._creationTime))
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id, at]) => ({ id, at }))
  }, [runs])
  const currentBatch = batch && batches.some((b) => b.id === batch) ? batch : batches[0]?.id
  const batchRuns = runs.filter((r) => r.batchId === currentBatch)
  const labels = useMemo(() => blindLabels(batchRuns.map((r) => r._id), currentBatch ?? ''), [batchRuns, currentBatch])
  const onTable = batchRuns.filter((r) => picked.includes(r._id))

  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : [p[1], id]))

  const check = async () => {
    setChecking(true)
    try {
      const list = await gatewayModels({ ids: rows.map((r) => r.model) })
      setModels(Object.fromEntries(list.map((m) => [m.id, m])))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const run = async () => {
    if (!scenarioId) return
    const candidates = rows
      .filter((r) => r.on)
      .map((r) => ({
        model: r.model,
        provider: r.provider,
        structured: r.structured,
        effort: r.reasoning === 'off' ? 'none' : r.reasoning && 'effort' in r.reasoning ? r.reasoning.effort : undefined,
        reasoningMaxTokens: r.reasoning && typeof r.reasoning === 'object' && 'maxTokens' in r.reasoning ? r.reasoning.maxTokens : undefined,
        maxTokens: r.maxTokens,
      }))
    if (candidates.length === 0) return
    setRunning(true)
    setPicked([])
    try {
      const result = await fanOut({ scenarioId, candidates, runs: runCount })
      setBatch(result.batchId)
      toast.success(`${result.runIds.length} runs measured`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const scenario = detail?.scenario as Scenario | undefined

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* chrome */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-cream-500 pb-3">
          <span className="font-display text-display-eyebrow uppercase tracking-eyebrow text-cream-100">Bench</span>
          <Mono>live · openrouter · blind</Mono>
          <div className="flex gap-1">
            {BENCH_SITES.map((s) => (
              <Pill key={s} size="sm" selected={site === s} onClick={() => set({ site: s, scenario: undefined })}>
                {s}
              </Pill>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Mono>reveal</Mono>
            <Pill size="sm" selected={!reveal} onClick={() => setReveal(false)}>
              blind
            </Pill>
            <Pill size="sm" selected={reveal} onClick={() => setReveal(true)}>
              shown
            </Pill>
          </div>
        </div>

        {/* scenarios */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Mono>scenarios</Mono>
          {forSite.map((s) => (
            <Pill key={s._id} size="sm" selected={s._id === scenarioId} onClick={() => set({ scenario: s._id })}>
              {s.name}
            </Pill>
          ))}
          {forSite.length === 0 && <Mono className="italic">none yet for this site</Mono>}
          <Pill size="sm" variant="ghost" selected={showSeeds} onClick={() => setShowSeeds(!showSeeds)} className="ml-auto">
            {showSeeds ? '− seed from log' : '+ seed from log'}
          </Pill>
          {scenario && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!window.confirm(`Delete scenario "${scenario.name}" and its ${runs.length} runs?`)) return
                await remove({ scenarioId: scenario._id })
                set({ scenario: undefined })
              }}
            >
              delete
            </Button>
          )}
        </div>
        {showSeeds && (
          <div className="mt-2 border-t border-hairline pt-2">
            <Mono>completed {site} calls in llmUsageLogs · newest first · a seed keeps the prompt verbatim</Mono>
            <ul className="mt-1 divide-y divide-hairline/20">
              {(seedable ?? [])
                .filter((l) => l.site === site)
                .map((l) => (
                  <li key={l._id} className="flex items-center gap-3 py-1.5 font-mono text-mono-label text-cream-300">
                    <Pill
                      size="sm"
                      onClick={async () => {
                        const id = await seed({ logId: l._id })
                        set({ scenario: id })
                        setShowSeeds(false)
                      }}
                    >
                      seed
                    </Pill>
                    <span className="flex gap-0.5">
                      {l.colors.filter(isManaColor).map((c) => (
                        <ManaSymbol key={c} color={c} size="sm" />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate italic text-cream-300">“{l.idea}”</span>
                    <Mono>{l.archetypes.join(' · ')}</Mono>
                    <Mono>{new Date(l._creationTime).toLocaleDateString()}</Mono>
                  </li>
                ))}
              {(seedable ?? []).filter((l) => l.site === site).length === 0 && (
                <li className="py-2 font-body text-body-small italic text-cream-400">No completed calls logged for this site.</li>
              )}
            </ul>
          </div>
        )}

        {scenario && (
          <>
            {/* scenario strip */}
            <Rule heavy />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
              <Mono>scenario</Mono>
              <div className="flex gap-1">
                {scenario.colors.filter(isManaColor).map((c) => (
                  <ManaSymbol key={c} color={c} size="sm" />
                ))}
              </div>
              <div className="flex gap-1">
                {scenario.archetypes.map((a) => (
                  <Pill key={a} size="sm">
                    {a}
                  </Pill>
                ))}
              </div>
              {scenario.requestedCount !== undefined && <Mono>{scenario.requestedCount} cards</Mono>}
              <span className="min-w-0 flex-1 truncate font-body text-body-small italic text-cream-300">“{scenario.idea}”</span>
              <Pill size="sm" variant="ghost" selected={showPrompt} onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? '− prompt' : '+ prompt'}
              </Pill>
            </div>
            {showPrompt && (
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-hairline pt-2 font-mono text-[11px] text-cream-400">
                {scenario.systemPrompt}
                {'\n\n'}
                {scenario.inputMessages.map((m) => `${m.role.toUpperCase()} — ${m.content}`).join('\n\n')}
              </pre>
            )}

            {/* slate */}
            <Rule />
            <div className="pt-3">
              <CandidateSlate site={site} rows={rows} setRows={setRows} models={models} onCheck={check} checking={checking} />
              <div className="mt-3 flex items-center gap-3">
                <Mono>runs each</Mono>
                {RUN_COUNTS.map((n) => (
                  <Pill key={n} size="sm" selected={runCount === n} onClick={() => setRunCount(n)}>
                    {n}
                  </Pill>
                ))}
                <Button className="ml-auto" onClick={run} disabled={running || rows.every((r) => !r.on)}>
                  {running ? <LoadingDots size="sm" /> : 'RUN BATCH'}
                </Button>
              </div>
            </div>

            {/* scoreboard */}
            <Rule heavy />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
              <Mono>scoreboard</Mono>
              {batches.map((b) => (
                <Pill key={b.id} size="sm" selected={b.id === currentBatch} onClick={() => { setBatch(b.id); setPicked([]) }}>
                  {new Date(b.at).toLocaleString()}
                </Pill>
              ))}
              {batches.length === 0 && <Mono className="italic">no runs yet · run a batch</Mono>}
              <Pill size="sm" variant="ghost" selected={why} onClick={() => setWhy(!why)} className="ml-auto">
                {why ? '− reasoning' : '+ reasoning'}
              </Pill>
            </div>
            {batchRuns.length > 0 && (
              <>
                <Scoreboard
                  site={site}
                  runs={batchRuns}
                  labels={labels}
                  reveal={reveal}
                  picked={picked}
                  onPick={pick}
                  onRank={(runId, r) => rank({ runId, rank: r })}
                />
                <Mono className="mt-1 block">
                  click a row to put it on the table · two at a time · red bar = over the product ceiling · red outline = card not on scryfall
                </Mono>
                {onTable.length > 0 && <OnTable site={site} runs={onTable} labels={labels} reveal={reveal} why={why} />}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
