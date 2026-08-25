# Manaschmiede

A Magic: The Gathering deck builder. It generates 60-card casual decks, then
lets you edit them by hand or by talking to an AI.

## Language

**Deck**:
Exactly 60 main-deck cards, casual. There is no sideboard.

**Rebuild**:
Producing a whole deck: the first generation, or a broad request that names no
specific cards.
_Avoid_: change, regenerate

**Delta**:
A targeted edit that names one to three specific cards.

**Locked card**:
A card the user pinned. Never removed, and never trimmed below the pinned
quantity.

**Trim**:
Cutting cards to bring a deck down to 60.

**Pad**:
Adding basic lands to bring a deck up to 60.

**Basic land**:
One of the five canonical M21 printings.

**Section plan**:
The list of sections a deck is built from, with a target count each. Derived
from the chosen archetype before any card is picked. `SectionTemplate` is the
per-archetype shape a plan is derived from, not the plan itself.

**Land target**:
The number of lands one archetype's plan allocates, counting fixing lands as
well as basics. Every target sits inside the land band.

**Land band**:
The 22 to 26 lands a casual 60-card deck lives inside.

**Fixing lands**:
Non-basic lands that produce more than one color. Paid for out of the land
target, not the spell slots.

**Curve**:
The average mana value of a deck's non-land cards. Advised, not enforced - see
`docs/adr/0005-land-count-planned-curve-advised.md`. Prose says "mana value";
`averageCmc` survives as a field name on `BalanceAnalysis`.
