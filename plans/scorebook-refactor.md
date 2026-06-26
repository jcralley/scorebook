---
title: Scorebook Architecture Refactoring
created: 2026-06-26
status: active
---

# Plan: Scorebook Architecture Refactoring

## Overview

`src/index.html` is a ~1200-line monolith mixing game logic, storage, and DOM rendering in a
single `<script>` block with no modules, no TypeScript, and no tests. This plan extracts the
architecture into three independent layers using event sourcing:

- **Game Data** (`src/types.ts`, `src/game-data.ts`) — pure types, constructors, serialization, migration
- **Game Engine** (`src/game-engine.ts`) — pure scoring logic, event replay, stats derivation
- **Presentation** (`src/storage.ts`, `src/render.ts`, `src/app.ts`) — localStorage adapter, DOM rendering, dispatch loop

The **event stream** (`GameRecord.events`) is the only persistent artifact. `GameState` is always
a pure projection derived by replaying it. Nothing except the stream is stored.

Toolchain: Vite (dev server + build), TypeScript (`tsc --noEmit` for type checking), Vitest (tests).

**Dependency rule (enforced by TypeScript imports):** Presentation → Engine → Data.
No layer imports from a layer above it. `game-engine.ts` never imports from `app.ts`, `render.ts`,
or `storage.ts`.

Each phase leaves the application in a working state — the user can open and use the scorecard
throughout the refactor.

---

## Progress Tracker

| Phase | Status | Commit | Notes |
|-------|--------|--------|-------|
| 0 — Toolchain | pending | — | Install Vite/TS/Vitest; tsconfig; verify dev server |
| 1 — Types and Engine | pending | — | types.ts, game-engine.ts, game-engine.test.ts |
| 2 — Data Layer | pending | — | game-data.ts, migrateFromV1 |
| 3 — Storage Adapter | pending | — | storage.ts (not wired to index.html yet) |
| 4 — Presentation Refactor | pending | — | app.ts, render.ts, index.html shell |

---

## Phase 0 — Toolchain

### Goal

Install Vite, TypeScript, and Vitest. Create `tsconfig.json`. Update `package.json` scripts.
Verify that `vite dev` serves the existing `src/index.html` unchanged — no application code
moves in this phase.

### Work Items

**1. Replace `package.json`** with:

```json
{
  "name": "scorebook",
  "version": "0.1.0",
  "description": "Offline-first digital baseball scorecard that runs in any browser.",
  "private": true,
  "scripts": {
    "start":      "python3 -m http.server 8000 --directory src",
    "serve":      "npx --yes serve src",
    "dev":        "vite",
    "build":      "vite build",
    "typecheck":  "tsc --noEmit",
    "test":       "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["baseball", "scorecard", "scorekeeping", "offline", "pwa"],
  "license": "UNLICENSED",
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite":       "^5.3.0",
    "vitest":     "^2.0.0"
  }
}
```

No runtime dependencies are added.

**2. Create `tsconfig.json`** at the project root with this exact content:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,

    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

**3. Run `npm install`** to install devDependencies.

**4. Run `npm run dev`** and verify the existing scorecard loads at `http://localhost:5173/src/`.
Vite serves `src/index.html` as a static file. No app code is touched.

### Design & Constraints

- `"noEmit": true` — Vite handles transpilation; `tsc` is type-checking only.
- `"isolatedModules": true` — required for Vite's transpile-only pipeline.
- `"noUncheckedIndexedAccess": true` — `atBats[n]` returns `AtBat | undefined`; every access site must guard.
- Vite's default root is the project directory. `src/index.html` is reachable at `/src/index.html`.
  No `vite.config.ts` is needed for Phase 0.
- The existing `index.html` `<script>` is not `type="module"`; Vite serves it as a static file
  without transforming it. This is correct behavior for Phase 0.

### Acceptance Criteria

1. `npm install` completes without error.
2. `npm run dev` starts. The existing scorecard loads and all features work (enter at-bat, view
   scoreboard, save game).
3. `npm run typecheck` exits 0 (no `.ts` files yet; "no input files" is acceptable).
4. `npm run test` exits 0 (no test files yet; "no test files found" is acceptable).
5. `npm run build` produces `dist/` without error.
6. `src/index.html` is not modified.

### Dependencies

None. This is the prerequisite for all other phases.

---

## Phase 1 — Types and Engine

### Goal

Create `src/types.ts` (all shared types), `src/game-engine.ts` (pure engine: RESULTS catalog,
event replay, scoring logic, stats), and `src/game-engine.test.ts` (8 worked-example tests plus
a `resolveStream` test). The existing `src/index.html` is not modified. `tsc --noEmit` and
`vitest run` both pass by the end of this phase.

### Work Items

#### 1. Create `src/types.ts`

Export every type below. No logic. No imports from other project modules.

```typescript
// ── Primitives ────────────────────────────────────────────────────────────────

export type Position = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type BattedBallType = 'ground' | 'fly' | 'line' | 'pop' | 'bunt' | 'none'
export type FieldingTouch = { fielder: Position }
export type FieldingSequence = {
  battedBallType: BattedBallType
  touches: FieldingTouch[]
}

export type RunnerOutcome = {
  startBase: 1 | 2 | 3
  endBase: 0 | 1 | 2 | 3 | 4   // 0 = out, 4 = scored
  outSequence?: number            // 1-indexed order in a DP/TP
  fieldingSequence?: FieldingSequence
}

export type BatterResultCode =
  | '1B' | '2B' | '3B' | 'HR' | 'IPHR' | 'GRD'
  | 'BB' | 'IBB' | 'HBP' | 'CI'
  | 'E'
  | 'FC'
  | 'K3'
  | 'K' | 'Kc'
  | 'GO' | 'FO' | 'LO' | 'PO' | 'BO'
  | 'SH' | 'SF' | 'IFF'
  | 'DP' | 'TP'

export type AtBatIntent = {
  result: BatterResultCode
  fieldingSequence?: FieldingSequence
  errorFielder?: Position
  hitBases?: 1 | 2 | 3 | 4
  endBase?: 0 | 1 | 2 | 3 | 4
  runnerOutcomes?: RunnerOutcome[]
  rbiOverride?: number
  sacFly?: boolean
}

export type BetweenPitchEvent =
  | { type: 'SB';  startBase: 1|2|3; toBase: 2|3|4 }
  | { type: 'CS';  startBase: 1|2|3; atBase: 2|3|4; fieldingSequence: FieldingSequence }
  | { type: 'PKO'; startBase: 1|2|3; fieldingSequence: FieldingSequence }
  | { type: 'WP' | 'PB' | 'BK'; advances: { from: 1|2|3; to: 2|3|4 }[] }
  | { type: 'DI';  startBase: 1|2|3; toBase: 2|3|4 }
  | { type: 'OA';  startBase: 1|2|3; atBase: 1|2|3|4; fieldingSequence: FieldingSequence }

export type PitchResult =
  | { type: 'B' }   // ball
  | { type: 'S' }   // called strike
  | { type: 'Ss' }  // swinging strike
  | { type: 'F' }   // foul
  | { type: 'T' }   // foul tip
  | { type: 'IP' }  // ball in play (terminal)

export type Player = { num: string; name: string }

export type BattingSlot = {
  player: Player
  defensivePos: string | null   // null = DH (bats but holds no defensive position)
}

export type GameRules = {
  dh: boolean
  innings: number
}

// ── Event Stream ──────────────────────────────────────────────────────────────

export type GameEvent =
  | { type: 'GAME_CREATED';  id: string; date: string;
      awayName: string; homeName: string; rules: GameRules }
  | { type: 'BATTING_SLOT_SET'; side: 'away'|'home'; slot: number; entry: BattingSlot }
  | { type: 'PITCHER_SET';   side: 'away'|'home'; pitcher: Player }
  | { type: 'DH_VACATED';    side: 'away'|'home'; slot: number; newDefensivePos: string }
  | { type: 'AT_BAT_RECORDED'; side: 'away'|'home'; inning: number;
      playerIndex: number; intent: AtBatIntent }
  | { type: 'AT_BAT_CLEARED';  side: 'away'|'home'; inning: number; playerIndex: number }
  | { type: 'PITCH_RECORDED';  side: 'away'|'home'; inning: number;
      playerIndex: number; pitch: PitchResult }
  | { type: 'BETWEEN_PITCH_RECORDED'; side: 'away'|'home'; inning: number;
      afterPlayerIndex: number; event: BetweenPitchEvent }
  | { type: 'INNING_CHANGED'; inning: number; half: 'top'|'bot' }
  | { type: 'VOID_EVENT';    seq: number }
  | { type: 'NOTE';          text: string }

export type GameRecord = {
  readonly version: 2
  readonly id: string
  readonly events: readonly GameEvent[]
}

// ── Derived types (engine output; NEVER stored) ───────────────────────────────

export type AtBat = {
  intent: AtBatIntent
  derived: {
    batterFinalBase: 0 | 1 | 2 | 3 | 4
    run: boolean
    rbi: number
    outOnBase: boolean
  }
}

// IMPORTANT: lineupAtStart is added to the HalfInning definition here.
// It is a snapshot of the TeamState at the start of this half-inning, captured by
// applyEvent on the first AT_BAT_RECORDED for this (side, inning) pair.
// computeHalfInning uses it to resolve which player occupies each batting slot.
export type HalfInning = {
  side: 'away' | 'home'
  inning: number
  lineupAtStart: TeamState
  atBats: Record<number, AtBat>        // keyed by batting slot 0–8 (sparse)
  betweenPitchEvents: BetweenPitchEvent[]
}

export type TeamState = {
  name: string
  battingOrder: BattingSlot[]          // always 9 entries; index = slot (0 = leadoff)
  pitcher: Player | null               // non-null only in DH games
  dhActive: boolean                    // false after DH_VACATED; always false in non-DH games
}

// GameState.innings is a FLAT ARRAY of HalfInning objects.
// There is NO state.away.innings or state.home.innings.
// Look up a half-inning with findHalfInning(state.innings, side, inning).
export type GameState = {
  id: string
  date: string
  rules: GameRules
  away: TeamState
  home: TeamState
  innings: HalfInning[]
  currentInning: number
  currentHalf: 'top' | 'bot'
}

// ── Supporting types ──────────────────────────────────────────────────────────

export type BaseState = {
  first:  AtBat | null
  second: AtBat | null
  third:  AtBat | null
  outs: number
}

export type BattingLine = {
  ab: number; h: number; r: number; rbi: number; bb: number; k: number; avg: string
}

export type InningStats = {
  runs: number; hits: number; walks: number; errors: number; lob: number
}

export type RunnerOutcomeOption = { label: string; outcome: RunnerOutcome }

export type RunnerPromptQuestion = {
  runnerStartBase: 1 | 2 | 3
  runnerLabel: string
  options: RunnerOutcomeOption[]
  defaultOption: RunnerOutcomeOption
}

export type RunnerPromptPlan = {
  forced: RunnerOutcome[]
  ambiguous: RunnerPromptQuestion[]
  extraOuts: number
}

export type GameSummary = {
  id: string; date: string; awayName: string; homeName: string; score: string
}

export type AtBatEditContext = {
  side: 'away' | 'home'
  inning: number
  playerIndex: number
  result: BatterResultCode | null
  hitBases: 1 | 2 | 3 | 4 | null
  endBase: 0 | 1 | 2 | 3 | 4 | null
  rbi: number
}

export type RunnerEditContext = {
  plan: RunnerPromptPlan
  answers: RunnerOutcome[]
  currentQuestionIndex: number
}

export type UIState = {
  activeModal: 'atbat' | 'runners' | 'roster' | 'games' | null
  atBatCtx: AtBatEditContext | null
  runnerCtx: RunnerEditContext | null
  rosterSide: 'away' | 'home'
}

export type AppState = {
  record: GameRecord | null       // source of truth; only this is stored
  gameState: GameState | null     // derived; never stored
  view: 'away' | 'home'
  savedGamesIndex: GameSummary[]
  ui: UIState
}
```

---

#### 2. Create `src/game-engine.ts`

Import only from `./types`. No DOM, no localStorage, no global state, no mutation of inputs.
All functions return new objects.

**2a. RESULTS catalog**

Type the catalog as `Record<BatterResultCode, ResultMeta>` where:

```typescript
type ResultMeta = {
  l: string                    // display label
  k: 'hit' | 'out' | 'on'    // kind
  base: 0 | 1 | 2 | 3 | 4   // bases earned by batter's own action
  t: string                    // full name / tooltip
  dp?: true                    // marks DP and TP
}
```

Full catalog (export as `export const RESULTS`):

```typescript
export const RESULTS: Record<BatterResultCode, ResultMeta> = {
  '1B':   { l:'1B',   k:'hit', base:1, t:'Single' },
  '2B':   { l:'2B',   k:'hit', base:2, t:'Double' },
  '3B':   { l:'3B',   k:'hit', base:3, t:'Triple' },
  'HR':   { l:'HR',   k:'hit', base:4, t:'Home Run' },
  'IPHR': { l:'HR',   k:'hit', base:4, t:'Inside-the-park HR' },
  'GRD':  { l:'2B',   k:'hit', base:2, t:'Ground-rule double' },
  'BB':   { l:'BB',   k:'on',  base:1, t:'Walk' },
  'IBB':  { l:'IBB',  k:'on',  base:1, t:'Intentional walk' },
  'HBP':  { l:'HBP',  k:'on',  base:1, t:'Hit by pitch' },
  'CI':   { l:'CI',   k:'on',  base:1, t:"Catcher's interference" },
  'E':    { l:'E',    k:'on',  base:1, t:'Reached on error' },
  'FC':   { l:'FC',   k:'on',  base:1, t:"Fielder's choice" },
  'K3':   { l:'K3',   k:'on',  base:1, t:'Dropped third strike (reached)' },
  'K':    { l:'K',    k:'out', base:0, t:'Strikeout (swinging)' },
  'Kc':   { l:'ꓘ',   k:'out', base:0, t:'Strikeout (looking)' },
  'GO':   { l:'GO',   k:'out', base:0, t:'Groundout' },
  'FO':   { l:'FO',   k:'out', base:0, t:'Flyout' },
  'LO':   { l:'LO',   k:'out', base:0, t:'Lineout' },
  'PO':   { l:'PO',   k:'out', base:0, t:'Popout' },
  'BO':   { l:'BO',   k:'out', base:0, t:'Bunt out' },
  'SH':   { l:'SAC',  k:'out', base:0, t:'Sacrifice bunt' },
  'SF':   { l:'SF',   k:'out', base:0, t:'Sacrifice fly' },
  'IFF':  { l:'IFF',  k:'out', base:0, t:'Infield fly' },
  'DP':   { l:'DP',   k:'out', base:0, t:'Double play', dp:true },
  'TP':   { l:'TP',   k:'out', base:0, t:'Triple play', dp:true },
}
```

FC note: `k:'on'` and `base:1` — batter reaches first base, triggering force cascade. The
out recorded on a baserunner during FC is stored in `intent.runnerOutcomes[].endBase === 0`.
For batting stats, FC counts as an AB (not a hit); see `computeBattingLine`.

**2b. `resolveStream`**

```typescript
export function resolveStream(events: readonly GameEvent[]): GameEvent[]
```

Algorithm:
1. Collect all voided seqs: `const voided = new Set(events.filter(e => e.type === 'VOID_EVENT').map(e => (e as {type:'VOID_EVENT';seq:number}).seq))`
2. Return `events.filter((_, i) => !voided.has(i))` — removes the event AT the voided index.
3. `VOID_EVENT` entries themselves are NOT filtered out (they have no effect in `applyEvent`).
4. Does not modify the input array.

**2c. `findHalfInning` (exported)**

```typescript
export function findHalfInning(
  innings: HalfInning[],
  side: 'away' | 'home',
  inning: number,
): HalfInning | undefined {
  return innings.find(h => h.side === side && h.inning === inning)
}
```

`GameState.innings` is a flat array. There is no `state.away.innings`. The spec example
`state.away.innings[0]` in Section 10.3 is incorrect; tests must use
`findHalfInning(state.innings, 'away', 1)` instead.

**2d. `applyEvent`**

```typescript
export function applyEvent(state: GameState | null, event: GameEvent): GameState
```

Discriminated switch on `event.type`. The `default` branch assigns to `never` to produce a
compile error if any variant of `GameEvent` is ever added without a handler.

Each case:

- **`GAME_CREATED`**: Create and return the initial `GameState`. `state` is null here.
  ```typescript
  const emptySlot: BattingSlot = { player: { num: '', name: '' }, defensivePos: null }
  return {
    id: event.id,
    date: event.date,
    rules: event.rules,
    away: { name: event.awayName,
            battingOrder: Array.from({ length: 9 }, () => ({ ...emptySlot })),
            pitcher: null, dhActive: event.rules.dh },
    home: { name: event.homeName,
            battingOrder: Array.from({ length: 9 }, () => ({ ...emptySlot })),
            pitcher: null, dhActive: event.rules.dh },
    innings: [],
    currentInning: 1,
    currentHalf: 'top',
  }
  ```

- **`BATTING_SLOT_SET`**: Replace `state[event.side].battingOrder[event.slot]` with `event.entry`.
  Return a new state object — do not mutate in place.

- **`PITCHER_SET`**: Return new state with `state[event.side].pitcher = event.pitcher`.

- **`DH_VACATED`**: Return new state with `state[event.side].dhActive = false` and
  `state[event.side].battingOrder[event.slot].defensivePos = event.newDefensivePos`.

- **`AT_BAT_RECORDED`**: See the detailed algorithm below.

- **`AT_BAT_CLEARED`**: Find the half-inning for `(event.side, event.inning)`. If not found,
  return state unchanged. Otherwise, remove key `event.playerIndex` from `atBats` (create a
  new object omitting that key). Recompute via `computeHalfInning`. Return new state with
  the updated half-inning.

- **`INNING_CHANGED`**: Return `{ ...state!, currentInning: event.inning, currentHalf: event.half }`.

- **`VOID_EVENT`**, **`NOTE`**: Return `state!` unchanged (no-op in state projection).

- **`BETWEEN_PITCH_RECORDED`**: Find or create the half-inning for `(event.side, event.inning)`.
  (If creating, snapshot `lineupAtStart = state![event.side]`.) Append `event.event` to
  `betweenPitchEvents`. Return new state.

- **`PITCH_RECORDED`**: Return `state!` unchanged (no-op; future feature).

- **`default`**:
  ```typescript
  const _exhaustive: never = event
  return state!
  ```

**AT_BAT_RECORDED algorithm inside `applyEvent`:**

```
1. Assert state is non-null (GAME_CREATED must always be first).
2. team = state[event.side]
3. existing = findHalfInning(state.innings, event.side, event.inning)
4. If existing is undefined:
     lineupAtStart = team  (snapshot; TeamState is treated as immutable)
     halfInning = { side: event.side, inning: event.inning, lineupAtStart,
                    atBats: {}, betweenPitchEvents: [] }
   Else:
     halfInning = existing
5. Write a stub AtBat at event.playerIndex (zeroed derived — computeHalfInning fills it in):
     stub: AtBat = { intent: event.intent,
                     derived: { batterFinalBase: 0, run: false, rbi: 0, outOnBase: false } }
     updatedAtBats = { ...halfInning.atBats, [event.playerIndex]: stub }
6. recomputed = computeHalfInning({ ...halfInning, atBats: updatedAtBats }, halfInning.lineupAtStart)
7. newInnings = replaceOrAddHalfInning(state.innings, recomputed)
   (replaceOrAddHalfInning: find existing entry for (side, inning), replace it; if not found, append)
8. Return { ...state, innings: newInnings }
```

**2e. `replayEvents`**

```typescript
export function replayEvents(events: readonly GameEvent[]): GameState {
  const effective = resolveStream(events)
  return effective.reduce(
    (state, event) => applyEvent(state, event),
    null as GameState | null,
  ) as GameState
}
```

**2f. `computeHalfInning` — THE FORCE ALGORITHM**

```typescript
export function computeHalfInning(
  halfInning: HalfInning,
  lineupAtStart: TeamState,
): HalfInning
```

Recomputes all `AtBat.derived` fields for the half-inning by replaying at-bats in ascending
`playerIndex` (batting order slot) order. Returns a new `HalfInning`; inputs are not mutated.

**Full algorithm — implementing agent must follow exactly:**

```
SETUP:
  slots = Object.keys(halfInning.atBats).map(Number).sort((a,b) => a - b)
  bases: { [b in 1|2|3]: AtBat | null } = { 1: null, 2: null, 3: null }
  resultAtBats: Record<number, AtBat> = {}

FOR EACH slot in slots:
  ab = halfInning.atBats[slot]
  if ab is undefined: continue   // guard for noUncheckedIndexedAccess
  R = RESULTS[ab.intent.result]
  hit = ab.intent.hitBases ?? R.base

  Initialize a mutable `derived` object for this batter:
    derived = {
      batterFinalBase: Math.max(hit, ab.intent.endBase ?? 0) as 0|1|2|3|4,
      run: false,
      rbi: ab.intent.rbiOverride ?? 0,
      outOnBase: false,
    }

  adv = ab.intent.runnerOutcomes ?? []

  Define helper applyExplicit(fromBase: 1|2|3):
    r = bases[fromBase]
    if r is null: return
    o = adv.find(x => x.startBase === fromBase)
    if o is undefined: return   // no explicit instruction; runner holds
    bases[fromBase] = null
    if o.endBase === 0:
      r.derived.outOnBase = true
    else if o.endBase >= 4:
      r.derived.run = true
      r.derived.batterFinalBase = 4
      derived.rbi++             // this batter earns the RBI
    else:
      bases[o.endBase] = r
      r.derived.batterFinalBase = Math.max(r.derived.batterFinalBase, o.endBase)

  ─── CASE 1: Home Run (hit >= 4) ───
  if hit >= 4:
    derived.rbi = 0
    for b in [3, 2, 1]:
      if bases[b] is not null:
        bases[b]!.derived.run = true
        bases[b]!.derived.batterFinalBase = 4
        derived.rbi++
        bases[b] = null
    derived.batterFinalBase = 4
    derived.run = true
    derived.rbi++   // batter's own run
    // Apply rbiOverride if set
    if ab.intent.rbiOverride !== undefined: derived.rbi = ab.intent.rbiOverride
    const thisAb: AtBat = { intent: ab.intent, derived }
    resultAtBats[slot] = thisAb
    // Do NOT place the batter in bases[] — they scored
    continue

  ─── CASE 2: DP or TP (R.dp === true) ───
  if R.dp:
    // Apply explicit runner outcomes lead-first (3 → 2 → 1).
    // Runners without an explicit outcome hold where they are.
    for b in [3, 2, 1]: applyExplicit(b)
    derived.batterFinalBase = 0   // batter is out
    derived.run = false
    // rbi was set to rbiOverride ?? 0 above
    const thisAb: AtBat = { intent: ab.intent, derived }
    resultAtBats[slot] = thisAb
    continue

  ─── CASE 3: Batter reaches (hit >= 1) ───
  if hit >= 1:
    // Track which runners score during this at-bat (to compute RBI).
    // A runner that scores while still in bases[] will have run set to true
    // by pushFrom or applyExplicit; count them after the cascade.
    const scoredBefore = new Set([1,2,3].filter(b => bases[b] !== null))

    // Define inner recursive function pushFrom:
    //   Pushes the runner currently on base b to base b+1, making room first.
    //   Never moves a null slot.
    function pushFrom(b: 1|2|3): void {
      const r = bases[b]
      if (r === null) return
      const nb = b + 1
      if (nb >= 4) {
        // Runner scores (reached home)
        r.derived.run = true
        r.derived.batterFinalBase = 4
        bases[b] = null
        // RBI counted after cascade, not here
      } else {
        // Make room at nb first (recurse), then move this runner there
        pushFrom(nb as 1|2|3)
        bases[nb] = r
        r.derived.batterFinalBase = Math.max(r.derived.batterFinalBase, nb)
        bases[b] = null
      }
    }

    // Force cascade: for each step the batter takes (1 through hit),
    // if a runner occupies that step's base, push them up.
    for (let step = 1; step <= hit; step++) {
      if (bases[step as 1|2|3] !== null) pushFrom(step as 1|2|3)
    }

    // Apply explicit (unforced) runner advances from runnerOutcomes, lead-first.
    for b in [3, 2, 1]: applyExplicit(b)

    // Count runs scored during this at-bat for RBI (if no override).
    let scoredCount = 0
    for (const b of scoredBefore) {
      const r = (resultAtBats values for the slot that was at b) — or check if that runner's derived.run is now true
    }
    // Simpler implementation: count all runners whose derived.run flipped to true
    // during this at-bat. Since derived objects are shared references, count newly
    // true run flags among the runners that were in bases[] before the cascade.
    // (See Note below on shared-reference counting.)
    if (ab.intent.rbiOverride === undefined) {
      derived.rbi = [1,2,3].filter(b => {
        // Check runners that started in bases[] for this at-bat
        // This requires tracking pre-cascade occupants
      }).length  // see implementation note below
    }

    // Place the batter on their earned base.
    derived.batterFinalBase = Math.max(derived.batterFinalBase, hit) as 0|1|2|3|4
    const thisAb: AtBat = { intent: ab.intent, derived }
    bases[hit as 1|2|3] = thisAb   // hit is 1|2|3 (hit >= 4 handled above)
    resultAtBats[slot] = thisAb
    continue

  ─── CASE 4: Non-reaching out (hit === 0, not DP/TP) ───
  [3, 2, 1].forEach(b => applyExplicit(b))
  derived.batterFinalBase = 0
  const thisAb: AtBat = { intent: ab.intent, derived }
  resultAtBats[slot] = thisAb

RETURN { ...halfInning, atBats: resultAtBats }
```

**Implementation Note — RBI counting in Case 3:**

Rather than using shared-reference tracking, implement the RBI count by:
1. Before the cascade, record which bases are occupied: `const preOccupied = new Set([1,2,3].filter(b => bases[b] !== null) as Array<1|2|3>)`
2. After the cascade and after `applyExplicit`, count how many of those pre-occupied AtBat
   references now have `derived.run === true`.
3. To do this, capture the actual AtBat objects before the cascade:
   `const preRunners: AtBat[] = [1,2,3].map(b => bases[b]).filter((r): r is AtBat => r !== null)`
4. After the cascade: `const scored = preRunners.filter(r => r.derived.run).length`
5. `derived.rbi = ab.intent.rbiOverride ?? scored`

Since `pushFrom` and `applyExplicit` mutate the `derived` objects of runners in-place (the runners
in `resultAtBats` share references with the objects in `bases[]`), this reference-equality check is
accurate.

**pushFrom recursion — correctness invariant:**

The recursion visits HIGHER bases first before moving any runner. Given bases 1, 2, 3 all occupied
and `hit = 1`:
- `step = 1` → `pushFrom(1)`: runner at 1 needs to move to 2. First call `pushFrom(2)`:
  - runner at 2 needs to move to 3. First call `pushFrom(3)`:
    - runner at 3 needs to move to 4 (≥ 4): runner scores. `bases[3] = null`.
  - Back in `pushFrom(2)`: `bases[3] = runner_2`, `bases[2] = null`.
- Back in `pushFrom(1)`: `bases[2] = runner_1`, `bases[1] = null`.
- Batter placed at `bases[1]`.

Result: runner from 3rd scores, runner from 2nd to 3rd, runner from 1st to 2nd, batter on 1st.

**FC handling:**

`FC` has `base: 1` and `k: 'on'`. Case 3 applies (hit = 1, batter reaches). The force cascade
fires exactly as for a single. The out on the baserunner is in `runnerOutcomes` and processed by
`applyExplicit`. The batter is placed on 1st. For `totalOuts`, the batter is NOT counted as an
out (k = 'on'); the runner out IS counted via the `outOnBase = true` derived field.

**2g. `basesBeforeAtBat`**

```typescript
export function basesBeforeAtBat(halfInning: HalfInning, slot: number): BaseState
```

Replicate the base-state tracking loop from `computeHalfInning`, but stop before processing
the at-bat at `slot`. Do NOT call `computeHalfInning` — that function does not return the
intermediate `bases` variable.

Algorithm:
```
slots = Object.keys(halfInning.atBats).map(Number).sort((a,b) => a - b)
       .filter(s => s < slot)                // only at-bats before target
bases = { 1: null, 2: null, 3: null }
outs = 0

For each earlier slot (same CASES as computeHalfInning):
  ab = halfInning.atBats[s]; if undefined skip
  R = RESULTS[ab.intent.result]; hit = ab.intent.hitBases ?? R.base
  adv = ab.intent.runnerOutcomes ?? []
  applyExplicit = same helper as computeHalfInning (updates bases[], does NOT track rbi)

  CASE HR (hit>=4): score all runners; clear bases; continue
  CASE DP/TP:       [3,2,1].forEach applyExplicit; outs++ (batter); continue
  CASE reaches (hit>=1): force cascade (pushFrom); [3,2,1].forEach applyExplicit; bases[hit]=ab; continue
  CASE out:         [3,2,1].forEach applyExplicit; outs++; continue

  Also count runner outs: for each RunnerOutcome where endBase===0, outs++

return {
  first:  bases[1],
  second: bases[2],
  third:  bases[3],
  outs:   Math.min(outs, 3),
}
```

**2h. `totalOuts`**

```typescript
export function totalOuts(halfInning: HalfInning): number {
  let outs = 0
  for (const ab of Object.values(halfInning.atBats)) {
    if (RESULTS[ab.intent.result].k === 'out') outs++
    for (const ro of ab.intent.runnerOutcomes ?? []) {
      if (ro.endBase === 0) outs++
    }
  }
  return Math.min(outs, 3)
}
```

**2i. `planRunnerPrompts`**

```typescript
export function planRunnerPrompts(
  halfInning: HalfInning,
  slot: number,
  result: BatterResultCode,
): RunnerPromptPlan
```

Called by the presentation layer before committing an at-bat, to determine which runner outcomes
need a user prompt.

**Full algorithm:**

```
1. baseState = basesBeforeAtBat(halfInning, slot)
   (Base state immediately before this batter's at-bat.)

2. R = RESULTS[result]
   hit = R.base
   batterReaches = (R.k === 'hit' || R.k === 'on')
   (Note: this captures 1B–HR, BB, IBB, HBP, CI, E, FC, K3 — all codes where batter safely
    reaches. For FC: k='on', base=1, so batterReaches=true and hit=1.)

3. Determine FORCED runners:
   forced = { 1: false, 2: false, 3: false }
   if batterReaches AND hit >= 1 AND baseState.first is not null:
     forced[1] = true
     if baseState.second is not null AND hit >= 2:
       forced[2] = true
       if baseState.third is not null AND hit >= 3:
         forced[3] = true
   (A runner is forced iff: batter reaches, the chain is unbroken from 1st up to and
    including that runner's base, and the batter's hit distance reaches at least that base.
    If 1st is empty, NO runner is forced — even runners on 2nd or 3rd.)

4. Compute forced RunnerOutcome list:
   forcedOutcomes: RunnerOutcome[] = []
   For b = 1, 2, 3:
     if forced[b] and baseState[first/second/third for b] is not null:
       // Forced runner advances: base b + hit steps, capped at 4
       forceEndBase = Math.min(b + hit, 4) as 0|1|2|3|4
       forcedOutcomes.push({ startBase: b as 1|2|3, endBase: forceEndBase })

5. isDP = R.dp === true
   extraOuts = isDP ? (result === 'TP' ? 2 : 1) : 0

6. occBases = ([1, 2, 3] as const).filter(b => baseState[b === 1 ? 'first' : b === 2 ? 'second' : 'third'] !== null)
   // occBases is in ascending order
   dpOutBases = isDP ? occBases.slice(0, extraOuts) : []
   // dpOutBases contains the LOWEST occupied bases — these are the trail runners
   // (nearest the batter), defaulted to Out in a DP/TP

7. ambiguous: RunnerPromptQuestion[] = []
   For b in [3, 2, 1]:
     runner = baseState[first/second/third for b]
     if runner is null: skip
     if forced[b] AND NOT isDP: skip   // silently resolved by force cascade
     
     // Find runner's name via lineupAtStart
     runnerSlot = find the key s in halfInning.atBats where halfInning.atBats[s] === runner
     runnerLabel = halfInning.lineupAtStart.battingOrder[runnerSlot]?.player.name
                   ?? `Runner on ${baseName[b]}`
     
     // Build options
     const baseName = { 1:'1st', 2:'2nd', 3:'3rd', 4:'home' }
     opts: RunnerOutcomeOption[] = []
     opts.push({ label:'Out', outcome:{ startBase:b, endBase:0 } })
     if NOT isDP:
       opts.push({ label:'Hold '+baseName[b], outcome:{ startBase:b, endBase:b } })
     for nb = b+1 to 3:
       opts.push({ label:'To '+baseName[nb], outcome:{ startBase:b, endBase:nb } })
     opts.push({ label:'Score', outcome:{ startBase:b, endBase:4 } })
     
     // Determine default option end base
     let defEndBase: 0|1|2|3|4
     if isDP:
       defEndBase = dpOutBases.includes(b) ? 0 : Math.min(b + 1, 4)
     else if R.k === 'hit':
       defEndBase = Math.min(b + (hit || 1), 4)
     else:
       defEndBase = b   // hold (for walks/errors where runner is unforced)
     defaultOption = opts.find(o => o.outcome.endBase === defEndBase) ?? opts[0]!
     
     ambiguous.push({ runnerStartBase:b, runnerLabel, options:opts, defaultOption })

8. Return { forced: forcedOutcomes, ambiguous, extraOuts }
```

**2j. `computeBattingLine`**

```typescript
export function computeBattingLine(
  state: GameState,
  side: 'away' | 'home',
  playerIndex: number,
): BattingLine
```

Iterate `state.innings` where `h.side === side`. For each, check `h.atBats[playerIndex]`.
Accumulate:
- `ab`: count at-bats. RESULTS with `k='hit'` → ab++; `k='out'` → ab++; result in
  `['E','FC','K3','CI']` (on-base codes that still count as AB) → ab++.
  NOT AB: `['BB','IBB','HBP','SH','SF']`.
- `h`: `RESULTS[result].k === 'hit'` → h++
- `r`: `ab.derived.run` → r++
- `rbi`: sum `ab.derived.rbi`
- `bb`: result in `['BB','IBB','HBP']` → bb++
- `k`: result in `['K','Kc']` → k++
- `avg`: `ab === 0 ? '---' : (h/ab).toFixed(3).replace('0.','.').replace('1.000','1.000')`

**2k. `computeInningStats`**

```typescript
export function computeInningStats(
  state: GameState,
  side: 'away' | 'home',
  inning: number,
): InningStats
```

Find `findHalfInning(state.innings, side, inning)`. If not found, return all-zero InningStats.
For each at-bat in the half-inning:
- `runs`: `ab.derived.run === true`
- `hits`: `RESULTS[ab.intent.result].k === 'hit'`
- `walks`: result in `['BB','IBB','HBP']`
- `errors`: result `=== 'E'`
- `lob`: `ab.derived.batterFinalBase >= 1 && !ab.derived.run && !ab.derived.outOnBase`

**2l. `computeLineScore`**

```typescript
export function computeLineScore(
  state: GameState,
  side: 'away' | 'home',
): number[]
```

Return `Array.from({ length: state.rules.innings }, (_, i) =>
  computeInningStats(state, side, i + 1).runs)`.

---

#### 3. Create `src/game-engine.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { replayEvents, resolveStream, findHalfInning } from './game-engine'
import type { GameEvent } from './types'
```

**Helper `makeStream(atBatEvents: GameEvent[]): GameEvent[]`:**

```typescript
function makeStream(atBatEvents: GameEvent[]): GameEvent[] {
  const events: GameEvent[] = [
    { type:'GAME_CREATED', id:'t', date:'2026-01-01',
      awayName:'Away', homeName:'Home', rules:{dh:false, innings:9} },
  ]
  for (let i = 0; i < 9; i++) {
    events.push({ type:'BATTING_SLOT_SET', side:'away', slot:i,
      entry:{ player:{ num:String(i+1), name:'A'+i }, defensivePos:String(i+1) } })
  }
  for (let i = 0; i < 9; i++) {
    events.push({ type:'BATTING_SLOT_SET', side:'home', slot:i,
      entry:{ player:{ num:String(i+1), name:'H'+i }, defensivePos:String(i+1) } })
  }
  // events[0] = GAME_CREATED, events[1-9] = away BATTING_SLOT_SET, events[10-18] = home BATTING_SLOT_SET
  // events[19+] = atBatEvents
  return [...events, ...atBatEvents]
}
```

**Test 1 — Runners on 2nd & 3rd, batter doubles → 3rd scores, 2nd goes to 3rd, batter on 2nd (1 run)**

Setup: slot 0 triples (→ 3rd); slot 1 doubles (→ 2nd, 1B empty so no force on slot 0);
slot 2 doubles (force cascade: batter enters 1B [empty, no push], enters 2B [slot 1 there,
pushFrom(2): pushFrom(3) scores slot 0; slot 1 → 3rd]; batter on 2nd).

```typescript
it('runners on 2nd & 3rd, batter doubles: 3rd scores, 2nd→3rd, batter on 2nd', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'3B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'2B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{result:'2B'} },
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.run).toBe(true)           // slot 0 scored from 3rd
  expect(half.atBats[1]?.derived.batterFinalBase).toBe(3)  // slot 1 forced to 3rd
  expect(half.atBats[2]?.derived.batterFinalBase).toBe(2)  // batter on 2nd
  expect(half.atBats[2]?.derived.rbi).toBe(1)
})
```

**Test 2 — Runners on 2nd & 3rd (1B empty), batter singles → no forces, runners hold (0 runs)**

```typescript
it('runners on 2nd & 3rd with empty 1st, batter singles: no forces, runners hold', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'3B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'2B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{result:'1B'} },
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.run).toBe(false)
  expect(half.atBats[0]?.derived.batterFinalBase).toBe(3)  // still on 3rd
  expect(half.atBats[1]?.derived.batterFinalBase).toBe(2)  // still on 2nd
  expect(half.atBats[2]?.derived.batterFinalBase).toBe(1)  // batter on 1st
  expect(half.atBats[2]?.derived.rbi).toBe(0)
})
```

**Test 3 — Men on 1st & 2nd, GDP → runner from 1st out, runner from 2nd advances to 3rd, batter out (0 runs)**

Setup: slot 0 walks (→ 1st); slot 1 walks (force: slot 0 → 2nd, slot 1 → 1st);
slot 2 DP with explicit outcomes: runner from 1st (slot 1, startBase:1) out, runner from 2nd
(slot 0, startBase:2) advances to 3rd.

```typescript
it('men on 1st & 2nd, GDP: runner from 1st out, runner from 2nd to 3rd, batter out', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'BB'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'BB'} },
    // After slot 1 BB: bases 1=slot1, 2=slot0 (slot 0 was forced from 1st to 2nd)
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{
        result:'DP',
        runnerOutcomes:[
          { startBase:2, endBase:3 },   // runner from 2nd (slot 0) advances to 3rd
          { startBase:1, endBase:0 },   // runner from 1st (slot 1) is out
        ]
      }
    },
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.batterFinalBase).toBe(3)  // slot 0: advanced to 3rd
  expect(half.atBats[0]?.derived.outOnBase).toBe(false)
  expect(half.atBats[1]?.derived.outOnBase).toBe(true)     // slot 1: out at 1st
  expect(half.atBats[2]?.derived.batterFinalBase).toBe(0)  // batter out
  expect(half.atBats[2]?.derived.run).toBe(false)
})
```

**Test 4 — Bases loaded, walk → runner from 3rd scores, all advance one, batter on 1st (1 run)**

Setup: three singles (force cascade loads the bases); fourth batter walks (force cascade scores the runner from 3rd).

```typescript
it('bases loaded, walk: runner from 3rd scores, all advance one, batter on 1st', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'1B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'1B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{result:'1B'} },
    // After 3 singles: bases 3=slot0, 2=slot1, 1=slot2
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:3, intent:{result:'BB'} },
    // BB forces: slot0 scores, slot1→3rd, slot2→2nd, batter→1st
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.run).toBe(true)           // slot 0 scored from 3rd
  expect(half.atBats[1]?.derived.batterFinalBase).toBe(3)  // slot 1 on 3rd
  expect(half.atBats[2]?.derived.batterFinalBase).toBe(2)  // slot 2 on 2nd
  expect(half.atBats[3]?.derived.batterFinalBase).toBe(1)  // batter on 1st
  expect(half.atBats[3]?.derived.rbi).toBe(1)
})
```

**Test 5 — Man on 1st, batter doubles → runner forced from 1st to 3rd, batter on 2nd (0 runs)**

```typescript
it('man on 1st, batter doubles: runner forced to 3rd, batter on 2nd', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'1B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'2B'} },
    // 2B: step=1 pushFrom(1): slot0 pushed → pushFrom(2) no-op → slot0 on 2nd
    //     step=2 pushFrom(2): slot0 pushed → pushFrom(3) no-op → slot0 on 3rd
    //     batter placed on 2nd
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.batterFinalBase).toBe(3)  // slot 0 on 3rd
  expect(half.atBats[0]?.derived.run).toBe(false)
  expect(half.atBats[1]?.derived.batterFinalBase).toBe(2)  // batter on 2nd
  expect(half.atBats[1]?.derived.rbi).toBe(0)
})
```

**Test 6 — Runners on 2nd & 3rd only (1B empty), batter singles → no forces (0 runs)**

```typescript
it('runners on 2nd & 3rd with 1B empty, batter singles: chain broken, no forces', () => {
  // Identical result to Test 2 — verifies the force algorithm's chain-break condition
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'3B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'2B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{result:'1B'} },
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  // 1B is empty: no force chain, runners on 2nd and 3rd hold
  expect(half.atBats[0]?.derived.run).toBe(false)
  expect(half.atBats[0]?.derived.batterFinalBase).toBe(3)
  expect(half.atBats[1]?.derived.batterFinalBase).toBe(2)
  expect(half.atBats[2]?.derived.batterFinalBase).toBe(1)
})
```

**Test 7 — Bases loaded, grand slam → 4 runs, 4 RBI (all score)**

```typescript
it('bases loaded, grand slam: 4 runs, 4 RBI', () => {
  const state = replayEvents(makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'1B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:1, intent:{result:'1B'} },
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:2, intent:{result:'1B'} },
    // Bases: 3=slot0, 2=slot1, 1=slot2
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:3, intent:{result:'HR'} },
  ]))
  const half = findHalfInning(state.innings, 'away', 1)!
  expect(half.atBats[0]?.derived.run).toBe(true)
  expect(half.atBats[1]?.derived.run).toBe(true)
  expect(half.atBats[2]?.derived.run).toBe(true)
  expect(half.atBats[3]?.derived.run).toBe(true)
  expect(half.atBats[3]?.derived.rbi).toBe(4)
  expect(half.atBats[3]?.derived.batterFinalBase).toBe(4)
})
```

**Test 8 — Void correction: AT_BAT_RECORDED then VOID_EVENT → at-bat disappears from state**

```typescript
it('VOID_EVENT removes a previously recorded at-bat', () => {
  // Baseline: 19 events (indices 0-18). AT_BAT_RECORDED is at index 19.
  const stream = makeStream([
    { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'GO'} },
    // index 19 = the AT_BAT_RECORDED above
    { type:'VOID_EVENT', seq:19 },
    // index 20 = the VOID_EVENT
  ])
  const state = replayEvents(stream)
  // The AT_BAT_RECORDED was voided: no half-inning should be created
  const half = findHalfInning(state.innings, 'away', 1)
  expect(half).toBeUndefined()
})
```

**Test 9 — `resolveStream` semantics: voided event excluded, VOID_EVENT itself kept**

```typescript
describe('resolveStream', () => {
  it('excludes the voided event and keeps the VOID_EVENT itself', () => {
    const events: GameEvent[] = [
      { type:'GAME_CREATED', id:'x', date:'2026-01-01',
        awayName:'A', homeName:'H', rules:{dh:false, innings:9} },
      // index 1:
      { type:'AT_BAT_RECORDED', side:'away', inning:1, playerIndex:0, intent:{result:'GO'} },
      // index 2:
      { type:'VOID_EVENT', seq:1 },
    ]
    const effective = resolveStream(events)
    expect(effective).toHaveLength(2)
    expect(effective[0]?.type).toBe('GAME_CREATED')
    expect(effective[1]?.type).toBe('VOID_EVENT')
    // AT_BAT_RECORDED at index 1 is excluded from the effective stream
  })
})
```

### Design & Constraints

- All engine functions are pure: same inputs → same outputs, no side effects.
- `HalfInning.atBats` uses `Record<number, AtBat>` (sparse). `noUncheckedIndexedAccess` forces
  every `atBats[n]` access to guard against `undefined`.
- `GameState.innings` is a flat array. `findHalfInning` is the only correct way to look up
  a half-inning. There is no `state.away.innings`.
- `lineupAtStart` is snapshotted by `applyEvent` when the first `AT_BAT_RECORDED` for a
  half-inning is processed. Subsequent `BATTING_SLOT_SET` events do not retroactively change
  the `lineupAtStart` of an already-created half-inning.
- The `readonly events: readonly GameEvent[]` constraint on `GameRecord` is enforced. No code
  anywhere may call `.push()` on `record.events`. Array spread is used exclusively.
- In Test 8, the makeStream helper puts GAME_CREATED at index 0, 9 away BATTING_SLOT_SET at
  indices 1–9, 9 home BATTING_SLOT_SET at indices 10–18, so the first AT_BAT_RECORDED appended
  is at index 19. The VOID_EVENT must target `seq: 19`.

### Acceptance Criteria

1. `npm run typecheck` exits 0. No TypeScript errors in `src/types.ts` or `src/game-engine.ts`.
2. `npm run test` exits 0. All 9 tests pass.
3. `src/game-engine.ts` has zero imports from `app.ts`, `render.ts`, `storage.ts`, or any DOM
   or localStorage API.
4. `src/index.html` is unmodified and continues to function in the browser via `npm run dev`.
5. Test 1: `atBats[0].derived.run === true`, `atBats[1].derived.batterFinalBase === 3`,
   `atBats[2].derived.batterFinalBase === 2`, `atBats[2].derived.rbi === 1`.
6. Test 4: `atBats[0].derived.run === true`, `atBats[3].derived.batterFinalBase === 1`,
   `atBats[3].derived.rbi === 1`.
7. Test 7: `atBats[3].derived.rbi === 4` and all four runners have `derived.run === true`.
8. Test 8: `findHalfInning(state.innings, 'away', 1)` returns `undefined`.
9. Test 9: `resolveStream` output has length 2 (GAME_CREATED and VOID_EVENT only).

### Dependencies

Phase 0 must be complete (`npm install` done, `npm run dev` verified).

---

## Phase 2 — Data Layer

### Goal

Create `src/game-data.ts` with constructors, serialization/deserialization, and `migrateFromV1`.
No logic beyond structuring event streams. `tsc --noEmit` passes. `src/index.html` is not modified.

### Work Items

#### 1. Create `src/game-data.ts`

Import only from `./types`.

**`newGameRecord`**

```typescript
export function newGameRecord(
  id: string,
  date: string,
  awayName: string,
  homeName: string,
  rules: GameRules,
): GameRecord
```

Returns a `GameRecord` whose events array contains exactly:
1. One `GAME_CREATED` event.
2. 9 `BATTING_SLOT_SET` events for `side: 'away'`, slots 0–8, each with
   `entry: { player: { num: '', name: '' }, defensivePos: null }`.
3. 9 `BATTING_SLOT_SET` events for `side: 'home'`, slots 0–8, same entry.

**`serializeRecord`**

```typescript
export function serializeRecord(record: GameRecord): string
```

Returns `JSON.stringify(record)`. No Date objects, no functions — the event stream is
already JSON-serializable.

**`deserializeRecord`**

```typescript
export function deserializeRecord(json: string): GameRecord
```

Returns `JSON.parse(json) as GameRecord`. If `JSON.parse` throws, let it propagate.
No schema validation in Phase 2 (can be added later).

**`migrateFromV1`**

```typescript
export function migrateFromV1(legacyGame: unknown): GameRecord
```

Converts a v1 game object (stored in localStorage by the current `src/index.html`) into
a v2 `GameRecord` with a synthetic event stream.

**V1 object shape:**
```
{
  id: string,
  date: string,
  inning: number,
  half: 'top' | 'bot',
  away: { name: string, roster: Array<{num:string, name:string, pos:string}> },
  home: { name: string, roster: Array<{num:string, name:string, pos:string}> },
  plays: {
    away: { [playerIndex: string]: { [inning: string]: V1Cell } },
    home: { [playerIndex: string]: { [inning: string]: V1Cell } },
  }
}

V1Cell = {
  code: string,          // v1 result code
  hit?: number,
  endBase?: number,
  manualRbi?: number,
  adv?: { [fromBase: string]: number | 'out' },
  // base, run, rbi, outOnBase — derived fields, IGNORED (recomputed by engine)
}
```

**Algorithm — emit events in this exact order:**

```
1. Emit GAME_CREATED:
   {
     type: 'GAME_CREATED',
     id: g.id,
     date: g.date,
     awayName: g.away.name ?? '',
     homeName: g.home.name ?? '',
     rules: { dh: false, innings: 9 }
   }
   (Cast legacyGame as any; use optional chaining throughout for safety.)

2. For side in ['away', 'home']:
   For slot = 0 to 8:
     r = g[side].roster[slot] ?? {}
     Emit BATTING_SLOT_SET:
     {
       type: 'BATTING_SLOT_SET',
       side,
       slot,
       entry: {
         player: { num: r.num ?? '', name: r.name ?? '' },
         defensivePos: r.pos || null,
       }
     }

3. For side in ['away', 'home']:
   For inning = 1 to 9:
     Collect all playerIndex keys in g.plays[side] that have an entry for this inning.
     Sort playerIndex keys NUMERICALLY ascending.
     For each playerIndex:
       cell = g.plays[side][playerIndex][String(inning)]
       if cell exists and cell.code is a non-empty string:
         Emit AT_BAT_RECORDED:
         {
           type: 'AT_BAT_RECORDED',
           side,
           inning,
           playerIndex: Number(playerIndex),
           intent: convertCell(cell)
         }

4. Emit INNING_CHANGED:
   { type: 'INNING_CHANGED', inning: g.inning ?? 1, half: g.half ?? 'top' }
```

**`convertCell(cell): AtBatIntent`**

```typescript
function convertCell(cell: Record<string, unknown>): AtBatIntent {
  const result = convertCode(String(cell['code'] ?? 'GO'))
  const hitBases = typeof cell['hit'] === 'number' && cell['hit'] >= 1 && cell['hit'] <= 4
    ? cell['hit'] as 1|2|3|4 : undefined
  const endBase = typeof cell['endBase'] === 'number'
    ? Math.min(Math.max(cell['endBase'], 0), 4) as 0|1|2|3|4 : undefined
  const rbiOverride = typeof cell['manualRbi'] === 'number' ? cell['manualRbi'] : undefined
  const runnerOutcomes = convertAdv(cell['adv'])
  const intent: AtBatIntent = { result }
  if (hitBases !== undefined) intent.hitBases = hitBases
  if (endBase !== undefined) intent.endBase = endBase
  if (rbiOverride !== undefined) intent.rbiOverride = rbiOverride
  if (runnerOutcomes !== undefined) intent.runnerOutcomes = runnerOutcomes
  return intent
}
```

**`convertCode(v1Code: string): BatterResultCode` — full mapping table:**

| V1 code | V2 BatterResultCode |
|---------|---------------------|
| `'1B'`  | `'1B'` |
| `'2B'`  | `'2B'` |
| `'3B'`  | `'3B'` |
| `'HR'`  | `'HR'` |
| `'K'`   | `'K'` |
| `'ꓘ'`  | `'Kc'` |
| `'GO'`  | `'GO'` |
| `'FO'`  | `'FO'` |
| `'LO'`  | `'LO'` |
| `'PO'`  | `'PO'` |
| `'BB'`  | `'BB'` |
| `'HBP'` | `'HBP'` |
| `'E'`   | `'E'` |
| `'FC'`  | `'FC'` |
| `'SF'`  | `'SF'` |
| `'SAC'` | `'SH'` |
| `'DP'`  | `'DP'` |
| `'TP'`  | `'TP'` |
| unknown | `'GO'` (log warning to console) |

**`convertAdv(adv: unknown): RunnerOutcome[] | undefined`**

```typescript
function convertAdv(adv: unknown): RunnerOutcome[] | undefined {
  if (!adv || typeof adv !== 'object') return undefined
  const outcomes: RunnerOutcome[] = []
  for (const [fromBaseStr, dest] of Object.entries(adv as Record<string, unknown>)) {
    const startBase = Number(fromBaseStr)
    if (startBase < 1 || startBase > 3) continue
    const endBase: 0|1|2|3|4 = dest === 'out' ? 0
      : typeof dest === 'number' ? Math.min(Math.max(dest, 0), 4) as 0|1|2|3|4
      : 0
    outcomes.push({ startBase: startBase as 1|2|3, endBase })
    // outSequence: not recoverable from v1 — omit
  }
  return outcomes.length > 0 ? outcomes : undefined
}
```

### Design & Constraints

- `migrateFromV1` uses `as any` internally (cast `legacyGame as Record<string, any>`) and uses
  optional chaining and nullish coalescing on every field access. It must not throw for any
  shape of legacyGame that a real saved game might produce.
- Derived fields (`cell.base`, `cell.run`, `cell.rbi`, `cell.outOnBase`) are NOT copied into
  the migrated intent — they are recomputed by the engine from the intent.
- `outSequence` in RunnerOutcome is deliberately absent from migrated records; v1's `adv` map
  does not preserve the recording order of outs.
- `rules: { dh: false, innings: 9 }` is hardcoded for all v1 games.
- The AT_BAT_RECORDED events in the migrated stream are ordered inning-first, then
  playerIndex-ascending. This ensures the events come out in a predictable order.

### Acceptance Criteria

1. `npm run typecheck` exits 0.
2. `npm run test` exits 0 (no regressions in Phase 1 tests).
3. `migrateFromV1` called with a real v1 game object returns a `GameRecord` with `version: 2`
   where `replayEvents(record.events)` does not throw.
4. A v1 game containing `code: 'ꓘ'` migrates to `result: 'Kc'`.
5. A v1 game containing `code: 'SAC'` migrates to `result: 'SH'`.
6. A v1 game containing `adv: { '2': 4, '3': 4 }` produces `runnerOutcomes` with
   `[{startBase:2, endBase:4}, {startBase:3, endBase:4}]` (or equivalent — order may vary).
7. `deserializeRecord(serializeRecord(record))` produces an equivalent record to the input.
8. `src/index.html` is unmodified and continues to function.

### Dependencies

Phase 1 must be complete (`src/types.ts` exists, `tsc --noEmit` passes).

---

## Phase 3 — Storage Adapter

### Goal

Create `src/storage.ts` with all localStorage logic, typed against `GameRecord`. Do NOT wire
`storage.ts` to `src/index.html` in this phase. `src/index.html` continues using its own inline
localStorage code. Phase 4 wires everything together.

### Work Items

#### 1. Create `src/storage.ts`

Import from `./types`, `./game-data`, `./game-engine`.

**localStorage key constants (mirror v1 for backward compatibility):**

```typescript
const LS_INDEX   = 'sb_games_index'
const LS_GAME    = (id: string) => `sb_game_${id}`
const LS_CURRENT = 'sb_current'
```

**`loadGamesIndex`**

```typescript
export function loadGamesIndex(): GameSummary[]
```

```typescript
try {
  return JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as GameSummary[]
} catch { return [] }
```

**`loadRecord`**

```typescript
export function loadRecord(id: string): GameRecord | null
```

```typescript
const raw = localStorage.getItem(LS_GAME(id))
if (!raw) return null
try {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed['version'] === 2) return deserializeRecord(raw)
  return migrateFromV1(parsed)  // v1 game: migrate on load
} catch { return null }
```

**`persistRecord`**

```typescript
export function persistRecord(record: GameRecord): void
```

```typescript
localStorage.setItem(LS_GAME(record.id), serializeRecord(record))
localStorage.setItem(LS_CURRENT, record.id)
// Compute summary from replayed state
const gs = replayEvents(record.events)
const awayRuns = computeLineScore(gs, 'away').reduce((a, b) => a + b, 0)
const homeRuns = computeLineScore(gs, 'home').reduce((a, b) => a + b, 0)
const summary: GameSummary = {
  id: record.id,
  date: gs.date,
  awayName: gs.away.name,
  homeName: gs.home.name,
  score: `${awayRuns}-${homeRuns}`,
}
// Update games index: remove old entry, prepend new
const index = loadGamesIndex().filter(s => s.id !== record.id)
index.unshift(summary)
localStorage.setItem(LS_INDEX, JSON.stringify(index))
```

**`deleteRecord`**

```typescript
export function deleteRecord(id: string): void
```

```typescript
localStorage.removeItem(LS_GAME(id))
const index = loadGamesIndex().filter(s => s.id !== id)
localStorage.setItem(LS_INDEX, JSON.stringify(index))
if (localStorage.getItem(LS_CURRENT) === id) {
  localStorage.removeItem(LS_CURRENT)
}
```

**`exportRecord`**

```typescript
export function exportRecord(record: GameRecord): string {
  return serializeRecord(record)
}
```

**`importRecord`**

```typescript
export function importRecord(json: string): GameRecord {
  const parsed = JSON.parse(json) as Record<string, unknown>
  if (parsed['version'] === 2) return deserializeRecord(json)
  return migrateFromV1(parsed)
}
```

### Design & Constraints

- `persistRecord` calls `replayEvents` to compute the summary for the index. This is the
  only replay call in storage — all other storage operations work with the raw record.
- `persistRecord` is called by `dispatch` (Phase 4), NOT inside `render`. This breaks the
  current `persist()` → `render()` coupling.
- Do NOT import from `app.ts` or `render.ts`.
- `loadRecord` auto-migrates v1 data silently. The caller (Phase 4's `initApp`) should call
  `persistRecord` after migration to write the v2 record back, so subsequent loads skip
  migration.

### Acceptance Criteria

1. `npm run typecheck` exits 0.
2. `npm run test` exits 0 (no regressions).
3. `loadRecord` called with an id whose stored data is v1 format returns a `GameRecord` with
   `version: 2` (confirms migration path works).
4. `persistRecord` followed by `localStorage.getItem('sb_game_<id>')` returns valid JSON with
   `version: 2`.
5. `loadGamesIndex` returns a `GameSummary[]` (may be empty if no games saved).
6. `importRecord` called with a v1 JSON string returns a v2 `GameRecord` without throwing.
7. `src/index.html` is unmodified and continues to function.

### Dependencies

Phase 2 must be complete (`src/game-data.ts` exists, `tsc --noEmit` passes).

---

## Phase 4 — Presentation Refactor

### Goal

Create `src/app.ts` and `src/render.ts`. Refactor `src/index.html` to a shell (remove all
`<script>` content, add `<script type="module" src="./src/app.ts">`). Wire all DOM event
handlers through `dispatch`. After this phase the full app runs through the new architecture.

### Work Items

#### 1. Create `src/app.ts`

Import from `./types`, `./game-engine`, `./game-data`, `./storage`, `./render`.

**Module-level singleton:**

```typescript
let state: AppState = {
  record: null,
  gameState: null,
  view: 'away',
  savedGamesIndex: [],
  ui: { activeModal: null, atBatCtx: null, runnerCtx: null, rosterSide: 'away' },
}
```

**`dispatch`:**

```typescript
export function dispatch(event: GameEvent): void {
  if (!state.record) throw new Error('dispatch called with no active game')
  // Create a new array — NEVER mutate state.record.events (it is readonly)
  const newEvents = [...state.record.events, event]
  const newRecord: GameRecord = { version: 2, id: state.record.id, events: newEvents }
  state = { ...state, record: newRecord, gameState: replayEvents(newEvents) }
  persistRecord(newRecord)
  render(state)
}
```

**`dispatchUI` (private — for modal/view state that is not a game event):**

```typescript
function dispatchUI(uiUpdate: Partial<UIState>): void {
  state = { ...state, ui: { ...state.ui, ...uiUpdate } }
  render(state)
}
```

**`initApp`:**

```typescript
export function initApp(): void {
  state = { ...state, savedGamesIndex: loadGamesIndex() }
  const currentId = localStorage.getItem('sb_current')
  if (currentId) {
    const record = loadRecord(currentId)
    if (record) {
      // If record was migrated (events differ from raw storage), persist v2 back
      state = { ...state, record, gameState: replayEvents(record.events) }
      persistRecord(record)  // no-op if already v2; safe to call unconditionally
    }
  }
  wireEventHandlers()
  render(state)
}

document.addEventListener('DOMContentLoaded', initApp)
```

**`uid()` (port from index.html):**

```typescript
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
```

**New game creation:**

```typescript
function startNewGame(awayName: string, homeName: string): void {
  const id = uid()
  const date = new Date().toISOString()
  const rules: GameRules = { dh: false, innings: 9 }
  // Build all events at once and apply them in a single batch (avoid 19 re-renders)
  const creationEvents: GameEvent[] = [
    { type:'GAME_CREATED', id, date, awayName, homeName, rules }
  ]
  for (let i = 0; i < 9; i++)
    creationEvents.push({ type:'BATTING_SLOT_SET', side:'away', slot:i,
      entry:{ player:{ num:'', name:'' }, defensivePos:null } })
  for (let i = 0; i < 9; i++)
    creationEvents.push({ type:'BATTING_SLOT_SET', side:'home', slot:i,
      entry:{ player:{ num:'', name:'' }, defensivePos:null } })
  const record: GameRecord = { version:2, id, events:creationEvents }
  state = { ...state, record, gameState: replayEvents(creationEvents) }
  persistRecord(record)
  render(state)
}
```

**Translation table — old global mutations → `dispatch` calls:**

| Old code (index.html) | Replacement in app.ts |
|-----------------------|----------------------|
| `G.plays[side][pi][inn] = cell` | `dispatch({ type:'AT_BAT_RECORDED', side, inning:inn, playerIndex:pi, intent })` |
| `delete G.plays[side][pi][inn]` | `dispatch({ type:'AT_BAT_CLEARED', side, inning:inn, playerIndex:pi })` |
| `G.away.roster[i] = player` | `dispatch({ type:'BATTING_SLOT_SET', side:'away', slot:i, entry })` |
| `G.home.roster[i] = player` | `dispatch({ type:'BATTING_SLOT_SET', side:'home', slot:i, entry })` |
| `G.inning = n; G.half = h` | `dispatch({ type:'INNING_CHANGED', inning:n, half:h })` |
| `view = 'away'` / `'home'` | `state = { ...state, view: 'away' }; render(state)` |
| New game | `startNewGame(awayName, homeName)` |
| Load saved game | `const r = loadRecord(id); state = { ...state, record:r, gameState: replayEvents(r.events) }; render(state)` |
| Open modal | `dispatchUI({ activeModal: '...' })` |
| Close modal | `dispatchUI({ activeModal: null, atBatCtx: null, runnerCtx: null })` |

**At-bat modal workflow in app.ts:**

```
openAtBat(side, inning, playerIndex):
  dispatchUI({ activeModal:'atbat',
               atBatCtx:{ side, inning, playerIndex, result:null, hitBases:null, endBase:null, rbi:0 } })

onResultSelected(result):
  dispatchUI({ atBatCtx:{ ...state.ui.atBatCtx, result } })

onAtBatSave():
  ctx = state.ui.atBatCtx (non-null at this point)
  intent: AtBatIntent = { result: ctx.result! }
  if ctx.hitBases: intent.hitBases = ctx.hitBases
  if ctx.endBase !== null: intent.endBase = ctx.endBase
  if ctx.rbi: intent.rbiOverride = ctx.rbi

  halfInning = findHalfInning(state.gameState?.innings ?? [], ctx.side, ctx.inning)
  plan = planRunnerPrompts(halfInning ?? emptyHalfInning, ctx.playerIndex, ctx.result!)

  if plan.ambiguous.length === 0:
    intent.runnerOutcomes = plan.forced
    dispatch({ type:'AT_BAT_RECORDED', side:ctx.side, inning:ctx.inning,
               playerIndex:ctx.playerIndex, intent })
    dispatchUI({ activeModal:null, atBatCtx:null })
  else:
    dispatchUI({ activeModal:'runners',
                 runnerCtx:{ plan, answers:plan.forced, currentQuestionIndex:0 } })

onRunnerAnswered(answer: RunnerOutcome):
  ctx = state.ui.runnerCtx!
  newAnswers = [...ctx.answers, answer]
  if ctx.currentQuestionIndex + 1 >= ctx.plan.ambiguous.length:
    // All runner questions answered — commit
    intent.runnerOutcomes = newAnswers
    dispatch({ type:'AT_BAT_RECORDED', ... })
    dispatchUI({ activeModal:null, atBatCtx:null, runnerCtx:null })
  else:
    dispatchUI({ runnerCtx:{ ...ctx, answers:newAnswers,
                              currentQuestionIndex: ctx.currentQuestionIndex + 1 } })
```

#### 2. Create `src/render.ts`

Port all render functions from `src/index.html`. Each function receives `AppState` or a
sub-portion; none reads global variables.

```typescript
import type { AppState, GameState, UIState } from './types'
import { RESULTS, findHalfInning, computeBattingLine, computeInningStats, computeLineScore,
         totalOuts } from './game-engine'

export function render(state: AppState): void {
  if (!state.gameState) {
    // Show empty / no-game state; open games modal
    return
  }
  renderScoreboard(state.gameState)
  renderGrid(state)
  renderBatStats(state.gameState, state.view)
  renderInningStats(state.gameState, state.view)
  renderLineScore(state.gameState)
  // Render modal states
  renderAtBatModal(state)
  renderRunnerModal(state)
  renderRosterModal(state)
  renderGamesModal(state)
  // NOTE: do NOT call persistRecord here — that is dispatch's responsibility
}

export function renderScoreboard(gameState: GameState): void { ... }
export function renderGrid(state: AppState): void { ... }
export function renderBatStats(gameState: GameState, side: 'away'|'home'): void { ... }
export function renderInningStats(gameState: GameState, side: 'away'|'home'): void { ... }
export function renderLineScore(gameState: GameState): void { ... }
```

The critical change: `persist()` is NOT called from `render`. It is called only from `dispatch`.

All `RESULTS[code]` references in render.ts use the exported `RESULTS` from `./game-engine`.

Port `basePathSVG` as a private helper (not exported).

#### 3. Refactor `src/index.html` to shell

**Remove:** the entire `<script>` block (from `<script>` to `</script>`, ~800 lines of JS).

**Keep:** all HTML structure (all divs, buttons, modals), the `<style>` tag (all CSS unchanged).

**Add** before `</body>`:
```html
<script type="module" src="/src/app.ts"></script>
```

The HTML structure must be identical to the pre-refactor version in terms of element IDs and
class names — `render.ts` expects the same DOM structure that `render()` in index.html used.

### Design & Constraints

- `dispatch` creates a new array (`[...state.record.events, event]`) — never pushes to the
  existing array. This satisfies `readonly events: readonly GameEvent[]` on `GameRecord`.
- `render` is called after every `dispatch`. It receives the full `AppState` including the
  already-computed `gameState` — render functions never call the engine.
- `persistRecord` is called inside `dispatch` only. Grep for `persist` must return zero hits
  in `render.ts`.
- The `uid()` function from the old index.html is ported to `app.ts`.
- Undo is NOT wired in this phase. Leave `// TODO: undo via record.events.slice(0, -1)` in
  `app.ts`. The readonly constraint means undo must create a new array (not pop).
- `startNewGame` batches all creation events into one render cycle to avoid 19 sequential
  re-renders.
- Modal state (open/close) uses `dispatchUI` (not `dispatch`) — modal visibility is not part
  of the game event stream.

### Acceptance Criteria

1. `npm run typecheck` exits 0.
2. `npm run test` exits 0 (all Phase 1 and 2 tests still pass).
3. **Full at-bat workflow (verify in browser via `npm run dev`):**
   a. Open a new game or load an existing one.
   b. Tap a cell in the grid to open the at-bat modal.
   c. Select a result (e.g., `2B`). If runners are on base, the runner modal appears with
      correct prompts. Make runner selections.
   d. Confirm. The scorecard cell shows the result. The scoreboard updates with the correct
      run total.
4. **Roster editing:** Open roster modal, change a player name, close. Player name appears in grid.
5. **Save / load:** Reload the page (`Ctrl+R`). The previously entered at-bat is still present.
   Confirms `persistRecord` is wired correctly in `dispatch`.
6. **Export / import:** Export a game as JSON. Import the JSON. The scorecard shows identical data.
7. **v1 migration:** If a v1 game exists in localStorage, loading it shows the correct scorecard
   with no console errors.
8. **No global G:** `typeof G === 'undefined'` in the browser console (G no longer exists).
9. `grep -n 'persist(' src/render.ts` returns no results (persist is not called from render).
10. `tsc --noEmit` exits 0.

### Dependencies

Phases 0, 1, 2, and 3 must all be complete.

---

## Appendix A — File Dependency Graph

```
src/types.ts
    ← imported by all modules below

src/game-data.ts
    imports: ./types

src/game-engine.ts
    imports: ./types

src/storage.ts
    imports: ./types, ./game-data, ./game-engine

src/render.ts
    imports: ./types, ./game-engine

src/app.ts
    imports: ./types, ./game-data, ./game-engine, ./storage, ./render

src/index.html
    <script type="module" src="/src/app.ts">
```

No module below `app.ts` in this graph imports from `app.ts`, `render.ts`, or `storage.ts`.
The engine and data layer are fully isolated from presentation and storage.

---

## Appendix B — Resolved Tensions from Research

**B.1 `readonly events` vs. `push`**

The spec's Section 6.2 pseudocode shows `state.record.events.push(event)`, which contradicts
the Section 10.5 type `readonly events: readonly GameEvent[]`. This plan resolves in favor
of readonly: `dispatch` uses array spread `[...state.record.events, event]` and never `.push()`.

**B.2 `GameState.innings` indexing**

`GameState.innings` is a flat `HalfInning[]`. Each `HalfInning` has its own `side` and
`inning` fields. There is NO `state.away.innings` — innings are on `GameState`, not on
`TeamState`. The spec example in Section 10.3 (`state.away.innings[0]`) is incorrect. Tests
use `findHalfInning(state.innings, 'away', 1)`.

**B.3 `lineupAtStart` on `HalfInning`**

The spec's Section 4.3 `HalfInning` definition does not include `lineupAtStart`. This plan adds
it because `computeHalfInning` needs to know which player occupies each batting slot — especially
after substitutions or in DH games. `applyEvent` snapshots `state[event.side]` (the current
`TeamState`) when creating a new `HalfInning` on the first `AT_BAT_RECORDED` for that
`(side, inning)` pair.

**B.4 `BATTING_SLOT_SET` vs. `PLAYER_SET`**

The spec's migration discussion (Section 8, Phase 2) references `PLAYER_SET` in passing. All
code in this plan uses `BATTING_SLOT_SET` consistently, matching the `GameEvent` union in
Section 4.2.

**B.5 FC result code kind**

V1's RESULTS catalog has `FC` with `k:'out'` and `base:1`. In the new typed RESULTS, `FC`
has `k:'on'` (batter reaches safely) and `base:1`. The out recorded during a fielder's choice
is captured in `intent.runnerOutcomes[].endBase === 0`. For batting stats in
`computeBattingLine`, FC is explicitly counted as an AB (matching baseball scoring rules)
despite `k:'on'`.

**B.6 Force algorithm correctness (chain-break rule)**

A runner is forced if and only if: (1) the batter reaches, (2) first base is occupied (the
chain is unbroken from the plate), (3) all intermediate bases are occupied up to and including
the runner's base, and (4) the batter's hit distance (`R.base`) reaches at least that base.
If first base is empty, NO runner is forced — even runners on 2nd or 3rd. This is implemented
in both `computeHalfInning` (via the `pushFrom` step-loop) and `planRunnerPrompts` (via the
forced-set computation).
