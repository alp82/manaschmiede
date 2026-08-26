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
import { useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { Layout } from '../components/Layout'
import { PrototypeSwitcher } from '../components/prototype/PrototypeSwitcher'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { cn } from '../lib/utils'

const VARIANTS = [
  { key: 'A', name: 'Plates — side by side, gate first' },
  { key: 'B', name: 'Duel — pairwise, gate last' },
  { key: 'C', name: 'Folio — one at a time, keyboard score' },
]
const SITES = ['chat.generate', 'suggestCombos', 'fillSection'] as const
type Site = (typeof SITES)[number]

export const Route = createFileRoute('/prototype/bench')({
  validateSearch: (s: Record<string, unknown>) => ({
    variant: typeof s.variant === 'string' ? s.variant : 'A',
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

  if (row.stopReason === 'max_tokens') hard.push('TRUNCATED')
  if (!parsed) hard.push('NO JSON')

  if (parsed && Array.isArray(parsed.cards)) {
    let total = 0
    for (const c of parsed.cards as Array<{ name?: string; quantity?: number }>) {
      const q = c.quantity ?? 1
      total += q
      if (c.name) names.add(c.name)
      lines.push(`${String(q).padStart(2)}  ${c.name ?? '?'}`)
      if (q > 4 && !/^(Plains|Island|Swamp|Mountain|Forest)$/.test(c.name ?? '')) scored.push(`>4× ${c.name}`)
    }
    if (site === 'chat.generate' && total !== 60) hard.push(`${total} CARDS`)
    if (site !== 'chat.generate') scored.push(`${total} cards`)
  } else if (parsed && Array.isArray(parsed.combos)) {
    for (const combo of parsed.combos as Array<{ name?: string; cards?: string[]; explanation?: string }>) {
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

// ---------- A: Plates ----------

function VariantA({ cands, reveal }: { cands: Candidate[]; reveal: boolean }) {
  const [rank, setRank] = useState<Record<string, number>>({})
  const n = cands.length
  return (
    <div className="overflow-x-auto">
      <div className="grid gap-x-6" style={{ gridTemplateColumns: `repeat(${n}, minmax(260px, 1fr))` }}>
        {cands.map((c) => (
          <section key={c.id} className="border-t border-cream-500 pt-2">
            <Identity c={c} reveal={reveal} />
            <div className="mt-2 border-b border-hairline pb-2">
              <GateStrip gate={c.gate} />
            </div>
            <div className="mt-2 flex gap-1">
              {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
                <Pill key={r} size="sm" selected={rank[c.id] === r} onClick={() => setRank({ ...rank, [c.id]: r })}>
                  {r}
                </Pill>
              ))}
            </div>
            <div className={cn('mt-3 max-h-[70vh] overflow-y-auto', c.gate.hard.length && 'opacity-40')}>
              <ResponseBody c={c} dense />
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
              <ResponseBody c={c} highlight={k === 0 ? r.names : l.names} />
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
      <div className="mt-4 columns-2 gap-8">
        <ResponseBody c={c} />
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
          <Mono>{all.length === 0 ? (rows ? 'no completed rows for this site' : 'loading') : `${cands.length} of ${all.length} on`}</Mono>
        </div>

        {prompt && (
          <details className="mt-3 border-b border-hairline pb-3">
            <summary className="cursor-pointer font-mono text-mono-marginal uppercase tracking-mono-marginal text-cream-500">
              prompt (first candidate's user turn — replay rows differ per call)
            </summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[12px] text-cream-300">{prompt}</pre>
          </details>
        )}

        <div className="mt-6">
          {cands.length > 0 && variant === 'A' && <VariantA cands={cands} reveal={reveal} />}
          {cands.length > 0 && variant === 'B' && <VariantB cands={cands} reveal={reveal} />}
          {cands.length > 0 && variant === 'C' && <VariantC cands={cands} reveal={reveal} />}
        </div>
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={(v) => set({ variant: v })} />
    </Layout>
  )
}
