/**
 * PROTOTYPE — throwaway. Wayfinder #57: "what does the bench look like, and
 * does using it feel like reviewing?"
 *
 * Three variants of a blind-review bench on `/prototype/bench`, switchable via
 * `?variant=`. Responses are REPLAYED from `llmUsageLogs` (offline, no gateway
 * key) — every completed row of the chosen action is one blind candidate.
 * Nothing persists; rankings live in memory and die on reload on purpose.
 *
 *   A  Plates  — N columns side by side, gate verdict on top (anchors), rank
 *                each column 1..N with pills.
 *   B  Duel    — pairwise, diff-highlighted, LEFT / TIE / RIGHT; gate verdicts
 *                only after the last pair (unanchored).
 *   C  Folio   — one candidate at a time, full width, keyboard 1–5 score;
 *                gate shown after scoring; standings table at the end.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexConnectionState, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { Layout } from '../components/Layout'
import { PrototypeSwitcher } from '../components/prototype/PrototypeSwitcher'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { cn } from '../lib/utils'
import { ManaSymbol } from '../components/ManaSymbol'
import { CardLightbox } from '../components/CardLightbox'
import { isManaColor, type ManaColor } from '../lib/mana-colors'
import { getCardImageUri, type ScryfallCard } from '../lib/scryfall/types'

const VARIANTS = [
  { key: 'D', name: 'Board — scenario, scoreboard, card art' },
  { key: 'A', name: 'Plates — prompt + two candidates, gate first' },
  { key: 'B', name: 'Duel — pairwise, gate last' },
  { key: 'C', name: 'Folio — one at a time, keyboard score' },
]
const SITES = ['chat.generate', 'suggestCombos', 'fillSection'] as const
type Site = (typeof SITES)[number]

export const Route = createFileRoute('/prototype/bench')({
  validateSearch: (s: Record<string, unknown>) => ({
    variant: typeof s.variant === 'string' ? s.variant : 'D',
    site: (SITES as readonly string[]).includes(String(s.site)) ? (s.site as Site) : 'suggestCombos',
  }),
  component: BenchPrototype,
})

// ---------- data ----------

interface LogRow {
  _id: string
  _creationTime: number
  status: string
  action: string
  model: string
  systemPrompt: string
  inputMessages: Array<{ role: string; content: string }>
  outputText?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  estimatedCostUsd?: number
  stopReason?: string
}

interface Candidate {
  id: string
  label: string // blind label
  model: string
  when: number
  prompt: string
  raw: string
  lines: string[] // what the reviewer reads
  names: Set<string> // for the duel diff
  gate: Gate
  combos: Array<{ name: string; cards: string[]; explanation: string }>
  cards: Array<{ name: string; quantity: number }>
}

interface Gate {
  hard: string[] // hard fails
  scored: string[] // soft findings
  latencyMs: number
  costUsd: number
  outTokens: number
}

function parseLoose(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/g, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

function toCandidate(row: LogRow, index: number, site: Site): Candidate {
  const raw = row.outputText ?? ''
  const parsed = parseLoose(raw) as Record<string, unknown> | null
  const hard: string[] = []
  const scored: string[] = []
  const lines: string[] = []
  const names = new Set<string>()
  const combos: Candidate['combos'] = []
  const cards: Candidate['cards'] = []

  if (row.stopReason === 'max_tokens') hard.push('TRUNCATED')
  if (!parsed) hard.push('NO JSON')

  if (parsed && Array.isArray(parsed.cards)) {
    let total = 0
    for (const c of parsed.cards as Array<{ name?: string; quantity?: number }>) {
      const q = c.quantity ?? 1
      total += q
      if (c.name) names.add(c.name)
      cards.push({ name: c.name ?? '?', quantity: q })
      lines.push(`${String(q).padStart(2)}  ${c.name ?? '?'}`)
      if (q > 4 && !/^(Plains|Island|Swamp|Mountain|Forest)$/.test(c.name ?? '')) scored.push(`>4× ${c.name}`)
    }
    if (site === 'chat.generate' && total !== 60) hard.push(`${total} CARDS`)
    if (site !== 'chat.generate') scored.push(`${total} cards`)
  } else if (parsed && Array.isArray(parsed.combos)) {
    for (const combo of parsed.combos as Array<{ name?: string; cards?: string[]; explanation?: string }>) {
      combos.push({ name: combo.name ?? '?', cards: combo.cards ?? [], explanation: combo.explanation ?? '' })
      lines.push(`§ ${combo.name ?? '?'}`)
      for (const n of combo.cards ?? []) {
        names.add(n)
        lines.push(`    ${n}`)
      }
      lines.push(`    — ${combo.explanation ?? ''}`)
      if ((combo.cards?.length ?? 0) < 2) hard.push('COMBO <2 CARDS')
    }
    if ((parsed.combos as unknown[]).length === 0) hard.push('0 COMBOS')
  } else if (parsed) {
    lines.push(...JSON.stringify(parsed, null, 2).split('\n'))
  } else {
    lines.push(...raw.split('\n'))
  }

  const latencyMs = row.durationMs ?? 0
  const limit = site === 'chat.generate' || site === 'suggestCombos' ? 120_000 : 10_000
  if (latencyMs > limit) hard.push(`${(latencyMs / 1000).toFixed(0)}s LATENCY`)

  const user = row.inputMessages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  return {
    id: row._id,
    label: String.fromCharCode(65 + index),
    model: row.model,
    when: row._creationTime,
    prompt: user,
    raw,
    lines,
    names,
    combos,
    cards,
    gate: { hard, scored, latencyMs, costUsd: row.estimatedCostUsd ?? 0, outTokens: row.outputTokens ?? 0 },
  }
}

// ---------- shared bits ----------

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500', className)}>
      {children}
    </span>
  )
}

function GateStrip({ gate, hidden }: { gate: Gate; hidden?: boolean }) {
  if (hidden) return <Mono>gate · hidden until ranked</Mono>
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-mono-marginal tracking-mono-marginal">
      <span className={gate.hard.length ? 'text-ink-red' : 'text-cream-300'}>
        {gate.hard.length ? `FAIL · ${gate.hard.join(' · ')}` : 'PASS'}
      </span>
      <span className="text-cream-500">{(gate.latencyMs / 1000).toFixed(1)}s</span>
      <span className="text-cream-500">${gate.costUsd.toFixed(4)}</span>
      <span className="text-cream-500">{gate.outTokens} out</span>
      {gate.scored.map((s) => (
        <span key={s} className="text-cream-400">
          {s}
        </span>
      ))}
    </div>
  )
}

function Identity({ c, reveal }: { c: Candidate; reveal: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-display text-display-eyebrow uppercase tracking-eyebrow text-cream-100">{c.label}</span>
      <Mono className={reveal ? 'text-cream-300' : 'text-cream-500'}>
        {reveal ? `${c.model} · ${new Date(c.when).toLocaleString()}` : '████████'}
      </Mono>
    </div>
  )
}

function ResponseBody({ c, highlight, dense }: { c: Candidate; highlight?: Set<string>; dense?: boolean }) {
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap font-mono text-cream-200',
        dense ? 'text-[12px] leading-[1.35]' : 'text-mono-label leading-[1.45]',
      )}
    >
      {c.lines.map((l, i) => {
        const name = l.replace(/^\s*\d+\s+/, '').trim()
        const unique = highlight && !highlight.has(name) && c.names.has(name)
        return (
          <div key={i} className={cn(unique && 'text-cream-100 bg-ash-700')}>
            {l}
          </div>
        )
      })}
    </pre>
  )
}

function StructuredBody({ c }: { c: Candidate }) {
  if (c.combos.length) {
    return (
      <ol className="divide-y divide-hairline/40">
        {c.combos.map((k, i) => (
          <li key={i} className="py-3">
            <div className="flex items-baseline gap-3">
              <Mono>{String(i + 1).padStart(2, '0')}</Mono>
              <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-100">{k.name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-mono-marginal tracking-mono-marginal text-cream-300">
              {k.cards.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
            <p className="mt-1.5 font-body text-body-small text-cream-300">{k.explanation}</p>
          </li>
        ))}
      </ol>
    )
  }
  if (c.cards.length) {
    const groups = [4, 3, 2, 1].map((q) => ({ q, rows: c.cards.filter((x) => x.quantity === q) })).filter((g) => g.rows.length)
    const odd = c.cards.filter((x) => x.quantity > 4)
    return (
      <div className="columns-2 gap-6 font-mono text-mono-label text-cream-200">
        {[...groups, ...(odd.length ? [{ q: 0, rows: odd }] : [])].map((g) => (
          <div key={g.q} className="mb-3 break-inside-avoid">
            <Mono className="block border-b border-hairline pb-1">{g.q ? `${g.q}×` : 'lands / other'}</Mono>
            {g.rows.map((r) => (
              <div key={r.name} className="flex justify-between gap-2 py-0.5">
                <span className="truncate">{r.name}</span>
                {!g.q && <span className="text-cream-500">{r.quantity}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return <ResponseBody c={c} dense />
}

// ---------- D: Board ----------

/** Rough scenario extraction from the prompt text — prototype only. */
function readScenario(prompt: string) {
  const colors = Array.from(new Set((prompt.match(/\(([WUBRG])\)/g) ?? []).map((m) => m[1]))).filter(isManaColor) as ManaColor[]
  const archetypes = (prompt.match(/^- ([A-Za-z][^(\n]*?)\s*\(/gm) ?? []).map((m) => m.replace(/^- /, '').replace(/\s*\($/, ''))
  const idea = prompt.match(/described their deck as:\s*"([^"]+)"/)?.[1] ?? prompt.split('\n')[0]
  return { colors, archetypes, idea }
}

function useCardArt(names: string[]) {
  const [art, setArt] = useState<Record<string, ScryfallCard>>({})
  const key = names.join('|')
  useEffect(() => {
    const missing = Array.from(new Set(names)).filter((n) => !art[n.toLowerCase()])
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const found: Record<string, ScryfallCard> = {}
      for (let i = 0; i < missing.length; i += 75) {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: missing.slice(i, i + 75).map((name) => ({ name: name.split(' // ')[0] })) }),
        })
        const json = (await res.json()) as { data?: ScryfallCard[] }
        for (const c of json.data ?? []) { found[c.name.toLowerCase()] = c; found[c.name.split(' // ')[0].toLowerCase()] = c }
      }
      if (!cancelled) setArt((a) => ({ ...a, ...found }))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return art
}

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <span className="inline-block h-[6px] w-24 align-middle bg-ash-700">
      <span className={cn('block h-full bg-cream-300', className)} style={{ width: `${pct}%` }} />
    </span>
  )
}

function CardArt({ name, card, missing, onOpen }: { name: string; card?: ScryfallCard; missing?: boolean; onOpen?: (card: ScryfallCard) => void }) {
  const uri = card ? getCardImageUri(card, 'small') : undefined
  return (
    <figure className={cn('w-[110px] shrink-0', missing && 'outline outline-1 outline-ink-red')}>
      {uri ? (
        <img src={uri} alt={name} className="block w-full cursor-pointer transition-transform hover:-translate-y-1" onClick={() => card && onOpen?.(card)} />
      ) : (
        <div className="flex aspect-[5/7] w-full items-end bg-ash-800 p-1 font-mono text-[10px] text-cream-400">
          {missing ? `✗ ${name}` : name}
        </div>
      )}
    </figure>
  )
}

function VariantD({ cands, reveal, prompt }: { cands: Candidate[]; reveal: boolean; prompt: string }) {
  const scenario = useMemo(() => readScenario(prompt), [prompt])
  const [rank, setRank] = useState<Record<string, number>>({})
  const [picked, setPicked] = useState<string[]>(() => cands.slice(0, 2).map((c) => c.id))
  const [why, setWhy] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const n = cands.length
  const shown = cands.filter((c) => picked.includes(c.id))
  const names = shown.flatMap((c) => [...c.names])
  const art = useCardArt(names)
  const max = {
    lat: Math.max(...cands.map((c) => c.gate.latencyMs), 1),
    cost: Math.max(...cands.map((c) => c.gate.costUsd), 0.0001),
    out: Math.max(...cands.map((c) => c.gate.outTokens), 1),
  }
  const pick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : [p[1], id]))
  const isMissing = (name: string) => Object.keys(art).length > 0 && !art[name.toLowerCase()]
  const [lightbox, setLightbox] = useState<{ cards: ScryfallCard[]; index: number } | null>(null)
  const open = (group: string[]) => (card: ScryfallCard) => {
    const cards = group.map((nm) => art[nm.toLowerCase()]).filter(Boolean)
    setLightbox({ cards, index: Math.max(0, cards.indexOf(card)) })
  }

  return (
    <div>
      {/* scenario strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cream-500 pb-3">
        <Mono>scenario</Mono>
        <div className="flex gap-1">
          {scenario.colors.map((c) => (
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
        <span className="min-w-0 flex-1 truncate font-body text-body-small italic text-cream-300">“{scenario.idea}”</span>
        <Pill size="sm" variant="ghost" selected={showPrompt} onClick={() => setShowPrompt(!showPrompt)}>
          {showPrompt ? '− prompt' : '+ prompt'}
        </Pill>
      </div>
      {showPrompt && (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border-b border-hairline py-2 font-mono text-[11px] text-cream-400">{prompt}</pre>
      )}

      {/* scoreboard */}
      <table className="mt-4 w-full font-mono text-mono-label tabular-nums">
        <thead>
          <tr className="text-left text-cream-500">
            <th className="w-8 py-1 font-normal" />
            <th className="py-1 pr-4 font-normal">GATE</th>
            <th className="pr-4 font-normal">LATENCY</th>
            <th className="pr-4 font-normal">COST</th>
            <th className="pr-4 font-normal">OUTPUT</th>
            <th className="pr-4 font-normal">YOUR RANK</th>
            <th className="font-normal">MODEL</th>
          </tr>
        </thead>
        <tbody>
          {cands.map((c) => {
            const on = picked.includes(c.id)
            const fail = c.gate.hard.length > 0
            return (
              <tr
                key={c.id}
                onClick={() => pick(c.id)}
                className={cn(
                  'cursor-pointer border-t border-hairline/20 text-cream-200 hover:bg-ash-800',
                  on && 'border-l-2 border-l-ink-red bg-ash-800',
                )}
              >
                <td className="py-2 pl-2 font-display text-display-eyebrow text-cream-100">{c.label}</td>
                <td className="pr-4">
                  {fail ? (
                    <span className="text-ink-red">✗ {c.gate.hard.join(' · ')}</span>
                  ) : (
                    <span className="text-cream-300">✓ pass</span>
                  )}
                </td>
                <td className="pr-4">
                  <Bar value={c.gate.latencyMs} max={max.lat} className={c.gate.latencyMs > 60_000 ? 'bg-ink-red' : undefined} />
                  <span className="ml-2 text-cream-400">{(c.gate.latencyMs / 1000).toFixed(0)}s</span>
                </td>
                <td className="pr-4">
                  <Bar value={c.gate.costUsd} max={max.cost} className={c.gate.costUsd > 0.05 ? 'bg-ink-red' : undefined} />
                  <span className="ml-2 text-cream-400">{(c.gate.costUsd * 100).toFixed(1)}¢</span>
                </td>
                <td className="pr-4">
                  <Bar value={c.gate.outTokens} max={max.out} />
                  <span className="ml-2 text-cream-400">{c.gate.outTokens}</span>
                </td>
                <td className="pr-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
                      <Pill key={r} size="sm" selected={rank[c.id] === r} onClick={() => setRank({ ...rank, [c.id]: r })}>
                        {r}
                      </Pill>
                    ))}
                  </div>
                </td>
                <td className="text-cream-500">{reveal ? c.model : '████████'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-1 flex items-center gap-4">
        <Mono>click a row to put it on the table · two at a time · red outline = card not on scryfall</Mono>
        <Pill size="sm" variant="ghost" selected={why} onClick={() => setWhy(!why)} className="ml-auto">
          {why ? '− reasoning' : '+ reasoning'}
        </Pill>
      </div>

      {/* table: card art */}
      <div className={cn('mt-6 grid gap-8', shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {shown.map((c) => (
          <section key={c.id} className="border-t-2 border-cream-500 pt-2">
            <Identity c={c} reveal={reveal} />
            {c.combos.length > 0 ? (
              <ol className="mt-3 space-y-4">
                {c.combos.map((k, i) => (
                  <li key={i}>
                    <div className="flex items-baseline gap-3">
                      <Mono>{String(i + 1).padStart(2, '0')}</Mono>
                      <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-100">{k.name}</span>
                    </div>
                    <div className="mt-2 flex gap-2 overflow-x-auto">
                      {k.cards.map((nm) => (
                        <CardArt key={nm} name={nm} card={art[nm.toLowerCase()]} missing={isMissing(nm)} onOpen={open(k.cards)} />
                      ))}
                    </div>
                    {why && <p className="mt-2 max-w-prose font-body text-body-small text-cream-300">{k.explanation}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {c.cards.map((r) => (
                  <div key={r.name} className="relative">
                    <CardArt name={r.name} card={art[r.name.toLowerCase()]} missing={isMissing(r.name)} onOpen={open(c.cards.map((x) => x.name))} />
                    <span className="absolute left-0 top-0 bg-ash-900 px-1 font-mono text-[11px] text-cream-100">{r.quantity}×</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      {lightbox && (
        <CardLightbox
          cards={lightbox.cards}
          currentIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(index) => setLightbox({ ...lightbox, index })}
        />
      )}
    </div>
  )
}

// ---------- A: Plates ----------

function VariantA({ cands, reveal, prompt }: { cands: Candidate[]; reveal: boolean; prompt: string }) {
  const [rank, setRank] = useState<Record<string, number>>({})
  const [shown, setShown] = useState<string[]>(() => cands.slice(0, 2).map((c) => c.id))
  const n = cands.length
  const visible = cands.filter((c) => shown.includes(c.id))
  const swap = (id: string) =>
    setShown((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 2 ? [...s, id] : [s[1], id]))
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Mono>on the table</Mono>
        {cands.map((c) => (
          <Pill key={c.id} size="sm" selected={shown.includes(c.id)} onClick={() => swap(c.id)}>
            {c.label}
          </Pill>
        ))}
        <Mono className="ml-2">two at a time · click to swap in</Mono>
      </div>
      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-3 border-t border-cream-500 pt-2">
          <Mono>prompt</Mono>
          <pre className="mt-2 max-h-[75vh] overflow-y-auto whitespace-pre-wrap font-body text-body-small text-cream-300">{prompt}</pre>
        </aside>
        {visible.map((c) => (
          <section key={c.id} className="col-span-4 border-t border-cream-500 pt-2">
            <div className="flex items-baseline justify-between">
              <Identity c={c} reveal={reveal} />
              <div className="flex gap-1">
                {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
                  <Pill key={r} size="sm" selected={rank[c.id] === r} onClick={() => setRank({ ...rank, [c.id]: r })}>
                    {r}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="mt-2 border-b border-hairline pb-2">
              <GateStrip gate={c.gate} />
            </div>
            <div className={cn('mt-1 max-h-[75vh] overflow-y-auto', c.gate.hard.length && 'opacity-40')}>
              <StructuredBody c={c} />
            </div>
          </section>
        ))}
      </div>
      <Standings cands={cands} score={(c) => (rank[c.id] ? n + 1 - rank[c.id] : 0)} reveal={reveal} />
    </div>
  )
}

// ---------- B: Duel ----------

function VariantB({ cands, reveal }: { cands: Candidate[]; reveal: boolean }) {
  const pairs = useMemo(() => {
    const p: Array<[Candidate, Candidate]> = []
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) p.push([cands[i], cands[j]])
    return p
  }, [cands])
  const [i, setI] = useState(0)
  const [wins, setWins] = useState<Record<string, number>>({})
  const done = i >= pairs.length
  const pair = pairs[i]

  const vote = (winner: Candidate | null) => {
    if (winner) setWins((w) => ({ ...w, [winner.id]: (w[winner.id] ?? 0) + 1 }))
    setI(i + 1)
  }
  useEffect(() => {
    if (done) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'a') vote(pair[0])
      if (e.key === 'd') vote(pair[1])
      if (e.key === 's') vote(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (pairs.length === 0) return <Mono>need at least two candidates</Mono>
  if (done)
    return (
      <>
        <Standings cands={cands} score={(c) => wins[c.id] ?? 0} reveal={reveal} showGate />
        <Button variant="secondary" className="mt-4" onClick={() => { setI(0); setWins({}) }}>
          AGAIN
        </Button>
      </>
    )

  const [l, r] = pair
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-cream-500 pb-2">
        <Mono>
          pair {i + 1} / {pairs.length}
        </Mono>
        <Mono>a · left    s · tie    d · right</Mono>
      </div>
      <div className="grid grid-cols-2 gap-6 pt-3">
        {[l, r].map((c, k) => (
          <section key={c.id}>
            <Identity c={c} reveal={reveal} />
            <div className="mt-1 border-b border-hairline pb-1">
              <GateStrip gate={c.gate} hidden />
            </div>
            <div className="mt-2 max-h-[62vh] overflow-y-auto">
              <StructuredBody c={c} />
            </div>
          </section>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-3 border-t border-hairline pt-3">
        <Button variant="secondary" onClick={() => vote(l)}>← {l.label} WINS</Button>
        <Button variant="ghost" onClick={() => vote(null)}>TIE</Button>
        <Button variant="secondary" onClick={() => vote(r)}>{r.label} WINS →</Button>
      </div>
      <Mono className="mt-2 block">highlighted rows are cards the other side did not pick</Mono>
    </div>
  )
}

// ---------- C: Folio ----------

function VariantC({ cands, reveal }: { cands: Candidate[]; reveal: boolean }) {
  const [i, setI] = useState(0)
  const [score, setScore] = useState<Record<string, number>>({})
  const c = cands[i]
  const scored = c ? score[c.id] !== undefined : false

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!c) return
      if (/^[1-5]$/.test(e.key)) setScore((s) => ({ ...s, [c.id]: Number(e.key) }))
      if (e.key === 'j' || e.key === 'Enter') setI((x) => Math.min(x + 1, cands.length))
      if (e.key === 'k') setI((x) => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, cands.length])

  if (!c)
    return (
      <>
        <Standings cands={cands} score={(x) => score[x.id] ?? 0} reveal={reveal} showGate />
        <Button variant="secondary" className="mt-4" onClick={() => setI(0)}>BACK TO FIRST</Button>
      </>
    )
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-baseline justify-between border-b border-cream-500 pb-2">
        <Identity c={c} reveal={reveal} />
        <Mono>
          {i + 1} / {cands.length} · 1–5 score · j next · k prev
        </Mono>
      </div>
      <div className="mt-2 border-b border-hairline pb-2">
        <GateStrip gate={c.gate} hidden={!scored} />
      </div>
      <div className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <Pill key={s} selected={score[c.id] === s} onClick={() => setScore({ ...score, [c.id]: s })}>
            {s}
          </Pill>
        ))}
        <Button variant="ghost" className="ml-auto" onClick={() => setI(i + 1)}>NEXT →</Button>
      </div>
      <div className="mt-4">
        <StructuredBody c={c} />
      </div>
    </div>
  )
}

// ---------- standings ----------

function Standings({
  cands,
  score,
  reveal,
  showGate,
}: {
  cands: Candidate[]
  score: (c: Candidate) => number
  reveal: boolean
  showGate?: boolean
}) {
  const sorted = [...cands].sort((a, b) => score(b) - score(a))
  return (
    <table className="mt-6 w-full border-t border-cream-500 font-mono text-mono-label tabular-nums">
      <thead>
        <tr className="text-left text-cream-500">
          <th className="py-1 pr-4 font-normal">#</th>
          <th className="pr-4 font-normal">CAND</th>
          <th className="pr-4 font-normal">HUMAN</th>
          {showGate && <th className="pr-4 font-normal">GATE</th>}
          <th className="pr-4 font-normal">LAT</th>
          <th className="pr-4 font-normal">COST</th>
          <th className="font-normal">MODEL</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((c, i) => (
          <tr key={c.id} className="border-t border-hairline/20 text-cream-200">
            <td className="py-1 pr-4">{i + 1}</td>
            <td className="pr-4">{c.label}</td>
            <td className="pr-4">{score(c)}</td>
            {showGate && (
              <td className={cn('pr-4', c.gate.hard.length ? 'text-ink-red' : 'text-cream-400')}>
                {c.gate.hard.length ? c.gate.hard.join(' · ') : 'PASS'}
              </td>
            )}
            <td className="pr-4">{(c.gate.latencyMs / 1000).toFixed(1)}s</td>
            <td className="pr-4">${c.gate.costUsd.toFixed(4)}</td>
            <td className="text-cream-500">{reveal ? c.model : '████████'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------- page ----------

function BenchPrototype() {
  const { variant, site } = Route.useSearch()
  const navigate = useNavigate()
  const set = (patch: Partial<{ variant: string; site: Site }>) =>
    navigate({ to: '/prototype/bench', search: { variant, site, ...patch }, replace: true })

  const rows = useQuery(api.llmUsageLogs.list, { limit: 500 }) as LogRow[] | undefined
  const conn = useConvexConnectionState()
  const [reveal, setReveal] = useState(false)
  const [off, setOff] = useState<Set<string>>(new Set())

  const all = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.action === site && r.status === 'complete')
        .slice(0, 6)
        .map((r, i) => toCandidate(r, i, site)),
    [rows, site],
  )
  const cands = all.filter((c) => !off.has(c.id))
  const prompt = all[0]?.prompt ?? ''

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-cream-500 pb-3">
          <span className="font-display text-display-eyebrow uppercase tracking-eyebrow text-cream-100">Bench</span>
          <Mono>replay · llmUsageLogs · prototype</Mono>
          <div className="flex gap-1">
            {SITES.map((s) => (
              <Pill key={s} size="sm" selected={site === s} onClick={() => set({ site: s })}>
                {s}
              </Pill>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Mono>reveal</Mono>
            <Pill size="sm" selected={!reveal} onClick={() => setReveal(false)}>BLIND</Pill>
            <Pill size="sm" selected={reveal} onClick={() => setReveal(true)}>SHOWN</Pill>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline pb-3">
          <Mono>candidates</Mono>
          <div className="flex gap-1">
            {all.map((c) => (
              <Pill
                key={c.id}
                size="sm"
                selected={!off.has(c.id)}
                onClick={() =>
                  setOff((o) => {
                    const n = new Set(o)
                    n.has(c.id) ? n.delete(c.id) : n.add(c.id)
                    return n
                  })
                }
              >
                {c.label}
              </Pill>
            ))}
          </div>
          <Mono>{all.length === 0 ? (rows ? 'no completed rows for this site' : `loading · ws ${conn.isWebSocketConnected ? 'connected' : 'NOT connected'} · ${conn.hasEverConnected ? 'has connected before' : 'never connected'} · ${import.meta.env.VITE_CONVEX_URL}`) : `${cands.length} of ${all.length} on`}</Mono>
        </div>

        {prompt && variant !== 'D' && (
          <details className="mt-3 border-b border-hairline pb-3">
            <summary className="cursor-pointer font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
              prompt (first candidate's user turn — replay rows differ per call)
            </summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[12px] text-cream-300">{prompt}</pre>
          </details>
        )}

        <div className="mt-6">
          {cands.length > 0 && variant === 'D' && <VariantD cands={cands} reveal={reveal} prompt={prompt} />}
          {cands.length > 0 && variant === 'A' && <VariantA cands={cands} reveal={reveal} prompt={prompt} />}
          {cands.length > 0 && variant === 'B' && <VariantB cands={cands} reveal={reveal} />}
          {cands.length > 0 && variant === 'C' && <VariantC cands={cands} reveal={reveal} />}
        </div>
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={(v) => set({ variant: v })} />
    </Layout>
  )
}
