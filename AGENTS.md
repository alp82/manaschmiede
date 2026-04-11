# Manaschmiede — Agent Guide

Manaschmiede is a Magic: The Gathering deck builder. It has a distinct visual
language called **Specimen**. Every UI decision must conform to it. Read this
file before writing or redesigning any UI.

## Design language: Specimen

**Thesis.** Manaschmiede is a type specimen for deckbuilders. Every screen is a
page in a specimen book. Every pill is a cataloged glyph. Every card is a
plate. Every interaction is a printing operation.

### Typography (three fonts, locked)

- **Display: Cinzel** — Roman capitals. Ritual moments, section titles, deck
  names, wordmark, Cinzel-hero CTAs on the homepage.
- **Body / UI: Geist** — sans-serif, warm. Paragraphs, labels, buttons,
  descriptions, AI chat responses. This replaces the earlier plan to use EB
  Garamond; the "reading serif" idea was abandoned in favor of sans-on-mono.
- **Metadata: JetBrains Mono** — warm monospace. Pill labels, button labels,
  step labels, numerals, marginalia, user commands in chat.

No serif body font. No fourth typeface. If a component seems to need one, it
doesn't — use Geist.

### Palette — ink on ash

- Background: `--ash-900` (~oklch 0.14), near-black warm
- Panels / elevated: `--ash-800`, hover surfaces `--ash-700`, hairline on
  dark `--ash-600`
- Text primary: `--cream-100` (~oklch 0.96)
- Text tiers: `--cream-200` strong / `--cream-300` secondary / `--cream-400`
  tertiary-metadata / `--cream-500` muted-eyebrow
- Hairlines: `--color-hairline` (cream-500 at 40% opacity), 1px, no rounded
  corners, anywhere
- **Single accent: ink-red** (`--ink-red`, wax-seal red). Used exclusively for
  live states — current step, selected item, primary CTA, active link. Never
  decorative.
- Mana pentagon (W/U/B/R/G) stays separate, used only for MTG-semantic things.
  Chrome is monochrome; mana is the only real color.

### Material

- Faint paper grain on background (felt not seen).
- Subtle ink bleed on Cinzel display type.
- Hairline rules (0.5–1px) as the structural language — not borders, not boxes.
- **No shadows, no glass, no gradients, no glow, no rounded corners. Ever.**
- Exception: Scryfall card art may glow/shadow because it's already painterly.

### Two voices

- **Reading mode** (home, wizard steps, deck hero): airy, generous whitespace
  (96–192px between sections), Cinzel-heavy, page-turn transitions, ambient
  motion.
- **Working mode** (card browser, deck editor, AI chat, lightbox): dense,
  mono-heavy, tight 16–24px grid, instant transitions, no whitespace ritual.
- Both on ink-on-ash. Same chrome, same type, same rules. Different tempo.

### Structural rules

- Base spacing unit: 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192.
- 12-col grid, 24px gutter. Reading content lives in cols 2–9.
- Brutalist-editorial signature = hairlines + Cinzel display + mono marginalia
  + zero rounding + zero shadows. (Earlier drafts cast a vertical "left margin
  rail" as the signature move; that component was deleted and never shipped.)

### Motion

- Ambient: hairlines draw in from ends (150ms), Cinzel titles settle
  (8px translate + fade, 250ms), hover opacity 40→100% no movement (120ms).
- Punctuation: wizard step transitions = page slide with overshoot; card
  operations = card-place animation with 8px overshoot + rotation correction.
- **Rule: nothing loops, nothing pulses, no breathing glows.** Motion is
  punctuation, not decoration.
- **Three allowed exceptions, and only these three:**
  - `animate-bounce` on the 3-square LoadingDots indicator (waiting signal).
  - `animate-pulse` on skeleton placeholders (ash-800 rectangles, waiting
    signal).
  - `foil-shimmer` keyframe on rare/mythic card art (painterly card-art
    exception).
- Any other looping animation is a bug.

### Sound

- Uses existing files: `click-soft`, `confirmation-001`, `close-001`,
  `card-place-1`, `card-slide-1`, `card-shuffle`.
- Pervasive: hover ticks (rate-limited), keystrokes, navigation, commits.
- Metaphor: cards primary, book/manuscript when context fits (page turns for
  step navigation, card sounds for card operations).
- Global toggle in header, localStorage-persisted, default ON.

### Homepage mood

"Magic! I want to start building now!" — invocation. Full-bleed Scryfall art
crop, Cinzel wordmark, single primary ink-red CTA "FORGE A NEW DECK", one
door, no carousel, no feature grid.

### References

- **Hades** — painterly ground, confident asymmetric composition, meaningful
  motion, strong hierarchy.
- **elio.dev** — monospace as a voice; brutalist-editorial restraint.

### How to apply

- Every new component: "would this fit in a type specimen book?" If not,
  redesign it.
- Default instinct for any UI problem: hairlines + mono labels + Cinzel titles
  + ink-on-ash + zero rounding + zero shadows.
- Ink-red only for genuinely live states. If tempted to use it decoratively,
  don't.
- Dense pages (deck editor, card list, chat) go in working mode — do not try
  to make them airy.
- Hero pages (home, wizard steps) go in reading mode — do not try to make
  them dense.

## Component kit — locked decisions

Sibling doc to the design language above; this section specifies components.

### Shared primitives (source of truth)

Six primitives carry most of the UI:

- **`<Button>`** (`src/components/ui/Button.tsx`) — action trigger. Variants:
  `primary` (default, ink-red fill), `secondary` (hairline), `destructive`,
  `ghost`. No `selected` state.
- **`<Pill>`** (`src/components/ui/Pill.tsx`) — toggleable value / filter /
  chip / tag / badge. Variants: `default` (hairline, inverts when selected),
  `ghost`. Has `selected` state and optional `indexLabel`.
- **Shared visual language:** `src/components/ui/button-styles.ts` exports
  `buttonLikeBase`, `buttonLikeVariants`, `buttonLikeSizes`. Both Button and
  Pill consume these so they can't drift. Edit there to adjust Specimen
  button visuals globally.
- **Horizontal hairline primitive** = Stepper + Tabs + Breadcrumb.
- **Floating hairline panel primitive** = Tooltip + Popover + Toast
  (margin variant).
- **Drawer primitive** = Dropdown + Combobox + Date picker.
- **Framed plate primitive** = Modal + Lightbox + confirmations.

### Button vs. Pill — when to use which

- **Action trigger** (verb — Save, Delete, Next, Back, Skip, Forge) → `<Button>`.
- **Toggleable value** (noun — a trait, a filter, a format, a tag, a rarity)
  → `<Pill>`.
- Both look identical when unselected; selected Pill inverts to cream fill +
  ash label + ink-red border.
- Primary / destructive / ghost Button variants don't exist on Pill (they
  don't make semantic sense for toggleable filters).

### Locked design decisions

1. **Hero CTA font:** Cinzel on homepage only ("FORGE A NEW DECK"); mono
   everywhere else.
2. **Checkbox glyph:** ✓ (check mark). An earlier spec called for X, but X
   on a cream fill read as a close/delete button in practice. Check mark
   reads unambiguously as "selected".
3. **Dropdown:** drawer pattern for format/type/set selectors; marginal pile
   pattern for dense in-context filters.
4. **Modal:** framed plate for card lightbox + destructive confirms; margin
   panel for informational details (e.g., "why did AI suggest this card?").
5. **Toast:** bottom-left margin panel default; top banner only for genuine
   errors.
6. **Icon library:** Phosphor (bold or duotone variant); never Lucide;
   custom sigils deferred.
7. **Chat is sans-on-mono epistolary:**
   - User message: **JetBrains Mono**, cream-100, left-aligned, preceded by
     `USER —` in mono-marginal.
   - AI message: **Geist**, cream-100, left-aligned, preceded by
     `MANASCHMIEDE —` in mono-marginal.
   - Separator between exchanges: ornamental rule with `§`.
   - No bubbles, no avatars, no right-aligned sender indication.
   - Input: textarea with bottom hairline only, mono input (commands), send
     button is a secondary Pill with `↵ SEND` label.
   - (The earlier "reading serif for AI chat" plan was abandoned — Geist is
     the reading voice.)

### Button variants

All share the Pill skeleton, all sharp corners, all hairline-based:

- **Primary CTA:** filled ink-red, cream label, Cinzel only on home, mono
  everywhere else.
- **Secondary:** hairline only, mono label, transparent fill (= default Pill).
- **Tertiary / link:** mono label, no border, ink-red underline on hover.
- **Destructive:** ink-red hairline + ink-red label, fills on hover.
- **Icon-only:** no border default, hairline square appears on hover,
  32×32 hit area.

### Text input

- No box — hairline underline only, full width.
- Label above in `mono-label` cream-300.
- Value in Geist `body-lead`.
- Caret: thin cream vertical slab (tall).
- Focus: underline (or container border) becomes cream-200 2px. **Never
  ink-red** — ink-red borders on inputs read as "error" in standard UX
  vocabulary and cause confusion.
- Error: underline ink-red + mono-tag error below in ink-red. Ink-red on
  inputs is reserved exclusively for error state.
- Placeholder: cream-500 italic Geist.

### Search input

Same as text input but mono value (searches are commands). Eyebrow `SEARCH`
in mono-marginal above. Optional `>` prompt in working-mode searches. Results
count in right margin in mono-num.

### Textarea (AI chat)

Multi-line, auto-grow, no resize handle, bottom hairline only.

### Checkbox / Radio

28×28 hairline square (no circles for radio — squares everywhere).
Checkbox: cream-100 fill + ash-900 ✓ when checked; hairline-bordered
square with subtle ash fill when unchecked (visibly advertises "you can
select this"). Radio: cream fill + single ink-red dot. The shared
primitive lives at `src/components/ui/Checkbox.tsx` and is visual-only —
parent cards / rows own the click.

### Toggle / Switch

Two mini-Pills side-by-side, one selected (cream fill). Not a rounded slider.
Label in mono-label to the left.

### Tabs

Share DNA with Stepper. Mono-label items along a horizontal hairline, vertical
ink-red slab under current, cream-500 for inactive. **Not yet extracted** —
the pattern exists inline in deck view, StepDeckFill, and the wizard stepper.
When touching more than one of those, extract to `src/components/ui/Tabs.tsx`.

### Modal / Overlay (framed plate)

Full backdrop ash-900 at 90%, content framed by heavy hairline, max-width
720px, no rounded corners, no shadow. Close sound: `close-001`.

### Margin panel (informational details)

Slides into right margin rail (cols 10–12) as hairline-framed panel. Page
content dims slightly.

### Tooltip

Tiny mono-tag label, hairline underline 1px above, no box, 6px offset,
`click-soft @ 0.05` volume on mount.

### Toast (default: margin variant)

Bottom-left, slides up, hairline-framed panel, persists until dismissed.
Top-banner full-width ink-red hairline slab only for errors, auto-dismiss 4s.
**Not yet built.** Deck view "Copied" state and PDF generation currently have
ad-hoc inline feedback. When adding notification-driven UX, build the shared
hook + component.

### Loading states

- **LoadingDots:** 3 bouncing cream squares, the one allowed `animate-bounce`
  loop. Currently duplicated across AiChat, StepCoreCards, and StepDeckFill
  with drifted sizes/colors. Extract to a shared primitive on next touch.
- **Spinner (specimen sample):** 2×2 grid of cream squares filling clockwise,
  12×12px.
- **Page skeleton:** ash-800 hairline rectangles; `animate-pulse` opacity
  40%→100% at 2s (the one allowed pulse — waiting signal).
- **Progress bar:** a horizontal hairline drawing itself left to right, solid
  cream when complete.

### Empty states

Centered Cinzel display-section title, Geist body-small italic cream-400,
single Pill CTA. No illustrations. **Not yet extracted** — used ad-hoc in
Homepage, Deck view, StepDeckFill, DeckCardList, AiChat. Extract to shared
`<EmptyState>` on next touch.

### Error states

Same as empty but Cinzel title in ink-red. Mono-tag error code in margin if
applicable. "TRY AGAIN" Pill. The ink-red hairline frame + body error + retry
button shape is duplicated across StepCoreCards and StepDeckFill — extract to
shared `<ErrorBox>` on next touch.

### Divider / rule

- `<hr>`: 1px cream-500 at 40% opacity, full width.
- Section rule: 1px cream-500 at 100%, column-width.
- Ornamental rule: centered 64px hairline with mono glyph (`§` or `·`) —
  reading mode only.

### Badge / chip

Same component as Pill at smaller size, uncommitted (non-interactive). Used
for `RECOMMENDED`, `NEW`, format tags.

### Accordion

Hairline between rows, mono-label title, `+` / `−` glyph on right (never a
chevron). Expanding: hairline below animates open, content in Geist.

### Table (working mode)

Full JetBrains Mono, tabular numerals. Hairline column dividers, hairline row
dividers at 20% opacity. Row hover: ash-800 bg, no movement. Selected row: 2px
ink-red slab on left edge. Sortable headers: mono-label with mono `▼` / `▲`.

### Content card (non-MTG)

Hairline rectangle, ash-800 bg, Cinzel display-section title, Geist body,
optional mono-label eyebrow. Hover: hairline opacity lift. Active: ink-red
hairline.

### MTG card thumbnail

Sharp rectangle (no rounding — overrides MTG convention). Hairline border on
hover, card nudges up 4px, cursor becomes mono crosshair. Click → lightbox.

### Mana symbols

Use Scryfall's official SVGs as-is. Never recolor, never reshape. Sizes: 14px
inline, 18px labels, 32px color selector.

### Navigation bar

Thin, mono-only. Left: `MANASCHMIEDE` wordmark in Cinzel display-eyebrow.
Right: mono-label links. Hairline below, full width. On home: **no nav bar** —
hero IS navigation.

### Scrollbars

Thin custom scrollbar, hairline cream-500, no rounding, no arrows, invisible
track. Thumb cream-300 on scroll, fades to cream-500 after 800ms.

### Code / kbd

Inline code: JetBrains Mono cream-200, ash-800 fill, hairline border.
`<kbd>`: small, hairline square, cream-100. Used for keyboard shortcuts.

### Layout primitives

- **Container:** max-width 1280px desktop, padded 24/48/96 (mobile/tablet/desktop).
- **Stack:** vertical spacing helper.
- **Inline:** horizontal spacing helper.
- **Grid:** 12-col with named regions.
- **Spread:** asymmetric magazine spread for wizard steps.

### Not yet designed (deferred)

Avatar, date picker, file upload, slider, video/audio player, map, pagination,
rich text editor.

## Mono tier discipline

`mono-marginal` and `mono-label` look similar but are **not interchangeable**:

- **`mono-marginal`** — 12px, tracking `+0.10em`. For eyebrows, breadcrumbs,
  marginalia, "USER —" / "MANASCHMIEDE —" chat headers, folio numerals.
- **`mono-label`** — 14px, tracking `+0.08em`. For pill labels, button labels,
  step labels, input labels.

**Why it matters:** swapping them (e.g. using `mono-marginal` on a button
label) tanks legibility at small sizes — this was the cause of a
contrast-fix regression during the Specimen rollout. When in doubt, use
`mono-label` for anything interactive and `mono-marginal` only for supporting
context.

## Feedback: don't use generic UI components

The user rejects UI that looks like generic framework defaults — blue pill
steppers, rounded buttons, uniform gray token grids, soft drop-shadowed cards
with glow effects. "Looks like Bootstrap" is the anti-signal.

**How to apply:**

- When a UI pattern looks wrong, the fix is almost never to change the
  information architecture (pills → cards → draft piles etc.). The fix is to
  redesign the component in the Specimen language: sharp corners, hairlines,
  mono labels, no shadows, no rounded pills, no blue.
- Before proposing "let's replace pattern X with pattern Y", first ask: is the
  IA actually broken, or does the component just look generic? Default
  assumption: IA is fine, component needs restyling.
- Avoid installing new shadcn/ui components uncritically. Existing shadcn
  components must be fully restyled (tokens, borders, typography, state
  colors) before use. Never ship a default shadcn look.

## Grouping without boxes

When you feel the urge to wrap a group of items in a container (plate, card,
bordered panel, ash-800 bg block) to make grouping visible, that's the wrong
move. Fix grouping with spacing, full-width rules, or type hierarchy instead.
The only "frames" in the specimen are the modal/lightbox (framed plate
primitive) and the margin panel (informational details). Section groupings,
list groupings, filter groupings — all hairlines and spacing, never boxes.

**How to apply:** if a section feels "hard to see as a group", the fix is a
heavier top rule (1–2px cream-500 at 100%), more vertical space above the next
section, or stronger type contrast on the section header. Never wrap it in a
hairline-bordered panel with an ash fill — that's a box, and boxes are not the
Specimen's structural language.

## Always use `cursor-pointer` on clickable elements

Tailwind's Preflight strips the browser default `cursor: pointer` from
`<button>`, so clickable elements look dead under the cursor unless you
opt back in. Every element that responds to a click — buttons, cards-as-
buttons, color swatches, icon toggles, pagination arrows, section headers
that collapse, mana symbols, filter pills — must have explicit
`cursor-pointer` in its class list.

**How to apply:**

- When you add an `onClick` handler, also add `cursor-pointer` to the
  element. If it's disabled, add `disabled:cursor-not-allowed` too.
- Don't rely on "it's a `<button>`, the browser will handle it" — it
  won't in this codebase.
- `<Button>` and `<Pill>` primitives already include `cursor-pointer` in
  `buttonLikeBase` — new primitives in `src/components/ui/` should too.

## Don't demote actions to marginalia

If an interactive control feels visually noisy where it lives, move it to
where actions belong (nav bar, button group inside the wizard nav, header
action cluster). Shrinking it, restyling it as a tertiary link, or dressing it
up as mono-marginal context to "reduce visual weight" is the wrong fix.
Marginalia is supporting context — it's never clickable intent.

**How to apply:** when tempted to make a control smaller or more "marginal" to
quiet a busy area, instead ask: is this control in the right semantic place?
A reset button next to the stepper is awkward because the stepper is
orientation, not action. Moving it to the wizard nav (where BACK / NEXT
already live) solves the noise problem without disguising the control.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
