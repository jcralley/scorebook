# Spec: Separate Game Data, Engine, and Presentation

## 1. Background

The scorebook application is currently a single-file monolith (`src/index.html`, ~1200 lines) mixing data types, game logic, and DOM rendering in the same scope. This makes the engine untestable in isolation, the data model implicit, and the UI difficult to evolve without risk of breaking scoring logic.

This spec defines a clean separation into three independent layers:

- **Game Data** — pure types and serialization, no logic
- **Game Engine** — scoring logic and state derivation, no DOM
- **Presentation** — UI rendering and user interaction, no direct state mutation

The architecture uses **event sourcing**: the event stream is the source of truth. `GameState` is a pure projection of that stream, always derivable by replaying events from the beginning. Nothing is stored except the stream itself.

Reference: [`scoring-styles.md`](./scoring-styles.md) for the full taxonomy of play outcomes that the data model must represent.

---

## 2. Current Architecture

```
src/index.html
│
├── Constants (RESULTS catalog, CSS)
├── Storage (localStorage read/write, scattered)
├── Game Logic
│   ├── recomputeInning(side, inn)
│   ├── basesBeforeAtBat(side, inn, pi)
│   └── planRunnerQuestions(side, inn, pi, code)
├── Rendering
│   ├── render(), renderScoreboard(), renderGrid()
│   ├── renderBatStats(), renderInningStats(), renderLineScore()
│   └── basePathSVG(base)
└── Modal Workflows
    ├── openAtBat() / commitAtBat()
    ├── renderRunnerQuestions()
    └── roster / games modals
```

**Problems:**

- `recomputeInning` reads from and writes to the global `G` object; it cannot be called with arbitrary data
- `persist()` is called inside `render()`, coupling storage to display
- There are no unit tests; correctness is verified only by manual use
- Adding a pitch-tracking or fielding-stats layer would require editing scoring logic embedded in UI code

---

## 3. Proposed Architecture

```
src/
├── types.ts           (Shared types: GameEvent, GameState, AtBatIntent, …)
├── game-data.ts       (Layer 1: Constructors, serialization, migration)
├── game-engine.ts     (Layer 2: Scoring logic, pure functions)
├── storage.ts         (Storage adapter: localStorage or IndexedDB)
├── render.ts          (Layer 3a: DOM rendering)
├── app.ts             (Layer 3b: AppState, dispatch, UI event handlers)
└── index.html         (Shell: <script type="module" src="./app.ts">)
```

The layers form a strict dependency order: Presentation → Engine → Data. No layer imports from a layer above it. See Section 10 for the TypeScript and toolchain plan.

---

## 4. Layer 1: Game Data (`game-data.js`)

Pure type definitions, constructors, and serialization. No logic, no DOM, no localStorage.

### 4.1 Play Data Types

These types appear inside events and are never stored independently.

```js
// Fielder position number (1–9)
type Position = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// Batted ball type prefix
type BattedBallType = 'ground' | 'fly' | 'line' | 'pop' | 'bunt' | 'none'

// A single fielder touch in a play sequence.
// The first touch in a sequence whose battedBallType is fly/line/pop = catch (out via catch).
// All subsequent touches = putout via throw.
type FieldingTouch = { fielder: Position }

// Ordered sequence of fielder touches for a play.
type FieldingSequence = {
  battedBallType: BattedBallType,
  touches: FieldingTouch[],  // ordered; length N = N putouts
}

// Result of a single runner during a play.
type RunnerOutcome = {
  startBase: 1 | 2 | 3,        // which base the runner started at
  endBase: 0 | 1 | 2 | 3 | 4,  // 0 = out, 4 = scored
  outSequence?: number,          // 1-indexed order of this out in the play (for DP/TP)
  fieldingSequence?: FieldingSequence,
}

// Result code for batter outcome.
type BatterResultCode =
  // Reaches
  | '1B' | '2B' | '3B' | 'HR' | 'IPHR' | 'GRD'
  | 'BB' | 'IBB' | 'HBP' | 'CI'
  | 'E'   // reached on error (errorFielder required)
  | 'FC'  // fielder's choice
  | 'K3'  // dropped third strike (reached)
  // Outs
  | 'K' | 'Kc'
  | 'GO' | 'FO' | 'LO' | 'PO' | 'BO'
  | 'SH' | 'SF' | 'IFF'
  | 'DP' | 'TP'

// What the scorer explicitly records for one at-bat.
// Only intent is stored; derived values are recomputed by the engine on replay.
type AtBatIntent = {
  result: BatterResultCode,
  fieldingSequence?: FieldingSequence,
  errorFielder?: Position,
  hitBases?: 1 | 2 | 3 | 4,
  endBase?: 0 | 1 | 2 | 3 | 4,
  runnerOutcomes?: RunnerOutcome[],
  rbiOverride?: number,
  sacFly?: boolean,
}

// Between-pitch event (baserunner action not tied to a batter result).
type BetweenPitchEvent =
  | { type: 'SB',  startBase: 1 | 2 | 3, toBase: 2 | 3 | 4 }
  | { type: 'CS',  startBase: 1 | 2 | 3, atBase: 2 | 3 | 4, fieldingSequence: FieldingSequence }
  | { type: 'PKO', startBase: 1 | 2 | 3, fieldingSequence: FieldingSequence }
  | { type: 'WP' | 'PB' | 'BK', advances: { from: 1|2|3, to: 2|3|4 }[] }
  | { type: 'DI',  startBase: 1 | 2 | 3, toBase: 2 | 3 | 4 }
  | { type: 'OA',  startBase: 1 | 2 | 3, atBase: 1|2|3|4, fieldingSequence: FieldingSequence }

// Individual pitch within an at-bat (for future pitch-count tracking).
type PitchResult =
  | { type: 'B' }   // ball
  | { type: 'S' }   // called strike
  | { type: 'Ss' }  // swinging strike
  | { type: 'F' }   // foul
  | { type: 'T' }   // foul tip
  | { type: 'IP' }  // ball in play; terminal — at-bat result stored in the AtBatRecorded event

// Player identity — number and name only. Role and defensive position are lineup-specific.
type Player = { num: string, name: string }

// One slot in the batting order.
// defensivePos is null for a DH: the player bats but holds no defensive assignment.
// In non-DH games every slot has a non-null defensivePos; one will be 'P' (pitcher).
type BattingSlot = {
  player: Player,
  defensivePos: string | null,
}

// Game rules that affect engine behavior and lineup structure.
type GameRules = {
  dh: boolean,      // designated hitter in effect
  innings: number,  // scheduled innings (9 standard; 7 common in doubleheaders/college)
}
```

### 4.2 Event Stream

The event stream is the **only** thing stored. Everything else is derived by replaying it.

Each event carries a `seq` — its zero-based index in the `events` array. Because the array is append-only, `seq` is stable: `events[seq]` always refers to the same event. Correction events use `seq` to reference earlier events without needing UUIDs.

```js
type GameEvent =
  // Game lifecycle
  | { type: 'GAME_CREATED', id: string, date: string,
      awayName: string, homeName: string,
      rules: GameRules }

  // Lineup management
  //
  // BATTING_SLOT_SET sets one slot in the 9-entry batting order (slot 0 = leadoff).
  // Used for the initial lineup and for mid-game substitutions (pinch hitter, etc.).
  // The engine resolves who occupied each slot in each inning by scanning these
  // events up to the start of that half-inning.
  | { type: 'BATTING_SLOT_SET', side: 'away'|'home', slot: number, entry: BattingSlot }
  //
  // PITCHER_SET records the current pitcher in a DH game, where the pitcher does not
  // occupy a batting slot. Multiple PITCHER_SET events model pitching changes.
  // Has no effect when rules.dh is false (pitcher is already in the batting order).
  | { type: 'PITCHER_SET',     side: 'away'|'home', pitcher: Player }
  //
  // DH_VACATED is the rare event where the DH's team puts the DH into a defensive
  // position. The DH role is eliminated for the remainder of the game: the current
  // pitcher (or a new one) takes the DH's batting slot, and the DH moves to defense.
  | { type: 'DH_VACATED',      side: 'away'|'home', slot: number,
      newDefensivePos: string }

  // Gameplay — batter
  | { type: 'AT_BAT_RECORDED', side: 'away'|'home', inning: number,
      playerIndex: number, intent: AtBatIntent }
  | { type: 'AT_BAT_CLEARED',  side: 'away'|'home', inning: number, playerIndex: number }

  // Gameplay — individual pitch (future)
  | { type: 'PITCH_RECORDED',  side: 'away'|'home', inning: number,
      playerIndex: number, pitch: PitchResult }

  // Gameplay — between-pitch baserunner events
  | { type: 'BETWEEN_PITCH_RECORDED', side: 'away'|'home', inning: number,
      afterPlayerIndex: number, event: BetweenPitchEvent }

  // Game flow
  | { type: 'INNING_CHANGED',  inning: number, half: 'top'|'bot' }

  // Corrections (see Section 4.5)
  | { type: 'VOID_EVENT',     seq: number }          // remove any event from the effective stream
  | { type: 'NOTE',           text: string }          // scorer annotation; no effect on derived state

// The full record persisted for one game.
type GameRecord = {
  version: 2,
  id: string,
  events: GameEvent[],
}
```

All events are **immutable** once appended. The stream only ever grows; nothing is deleted or modified in place. Corrections are made by appending new events.

### 4.3 Derived Types (output of engine replay, never stored)

```js
// Engine output for one at-bat.
type AtBat = {
  intent: AtBatIntent,
  derived: {
    batterFinalBase: 0 | 1 | 2 | 3 | 4,
    run: boolean,
    rbi: number,
    outOnBase: boolean,
  },
}

// One half-inning as reconstructed by the engine.
type HalfInning = {
  side: 'away'|'home',
  inning: number,
  atBats: { [playerIndex: number]: AtBat },
  betweenPitchEvents: BetweenPitchEvent[],
}

// The active lineup for one team as reconstructed at a point in the stream.
// battingOrder always has exactly 9 entries.
// pitcher is non-null only in DH games (the pitcher who does not bat).
// After DH_VACATED, dhActive becomes false and the pitcher slot is folded into battingOrder.
type TeamState = {
  name: string,
  battingOrder: BattingSlot[],  // 9 entries; slot 0 = leadoff
  pitcher: Player | null,        // current pitcher not in batting order (DH games only)
  dhActive: boolean,             // false once DH_VACATED; always false in non-DH games
}

// Full derived game state (projection of the event stream).
type GameState = {
  id: string,
  date: string,
  rules: GameRules,
  away: TeamState,
  home: TeamState,
  innings: HalfInning[],
  currentInning: number,
  currentHalf: 'top'|'bot',
}
```

`GameState` is a pure function of the event stream. It is never stored and never treated as a source of truth.

### 4.4 Serialization

```js
// Serialize / deserialize the event stream (for localStorage and file export).
export function serializeRecord(record: GameRecord): string
export function deserializeRecord(json: string): GameRecord

// Migrate a v1 game (plays map format) into a v2 GameRecord.
// Produces a synthetic event stream: one GAME_CREATED, PLAYER_SET events per player,
// and AT_BAT_RECORDED events ordered by inning and batting order.
// Fields with no v1 equivalent (FieldingSequence, BetweenPitchEvent) are absent.
export function migrateFromV1(legacyGame): GameRecord
```

### 4.5 Correction Model

The stream supports three correction patterns, covering everything from a single-field ruling change to a structurally wrong sequence of events. All corrections are append-only; the original events are preserved as audit history.

#### Pattern 1 — Re-record (value correction)

`AT_BAT_RECORDED` is keyed by `(side, inning, playerIndex)`. Appending a new event for the same cell replaces the prior intent when the engine replays. No special correction event is needed.

**Example: official scorer changes E→1B**

```
[0] AT_BAT_RECORDED { side:'away', inning:3, playerIndex:4, intent:{ result:'E', errorFielder:6 } }
    ... several more at-bats recorded during the game ...
[9] AT_BAT_RECORDED { side:'away', inning:3, playerIndex:4, intent:{ result:'1B' } }
    ↑ ruling changed; engine uses intent from [9] for this cell; [0] is preserved as audit history
```

The same pattern applies to `PLAYER_SET` (updating a roster entry) and `INNING_CHANGED` (correcting the current inning marker). Any event type that is naturally idempotent by key uses this pattern.

#### Pattern 2 — Void (remove an erroneously recorded event)

`VOID_EVENT { seq }` marks any event as if it were never recorded. The engine skips voided events during replay.

**Example: recorded an at-bat for the wrong player**

```
[4] AT_BAT_RECORDED { side:'home', inning:2, playerIndex:5, intent:{ result:'K' } }
    ↑ oops — this was actually player 6's slot, not player 5's
[5] VOID_EVENT { seq: 4 }
[6] AT_BAT_RECORDED { side:'home', inning:2, playerIndex:6, intent:{ result:'K' } }
```

Voiding does not cascade: if [4] was a legitimate correction, voiding [5] re-enables [4] on the next replay. You can void a `VOID_EVENT` to undo a void.

#### Pattern 3 — Late recording (skipped at-bat)

The engine computes each half-inning by processing at-bats in **batting order** (by `playerIndex`), not in the order events appear in the stream. A missed at-bat can therefore be recorded at any time by simply appending an `AT_BAT_RECORDED` for the correct cell. The engine automatically places it in the right position in the inning sequence on replay.

**Example: realized player 3's at-bat in inning 4 was never entered**

```
[14] AT_BAT_RECORDED { side:'away', inning:4, playerIndex:5, intent:{ result:'GO' } }
[15] AT_BAT_RECORDED { side:'away', inning:4, playerIndex:6, intent:{ result:'BB' } }
     ... game continues ...
[22] AT_BAT_RECORDED { side:'away', inning:4, playerIndex:3, intent:{ result:'1B' } }
     ↑ recorded late; engine slots it before playerIndex 5 when computing inning 4
```

The same principle applies to `BETWEEN_PITCH_RECORDED`: it is anchored by `afterPlayerIndex`, which determines where in the inning it logically falls regardless of when it was appended.

#### Cascade awareness

Correcting an early at-bat can change the base state that later at-bats were recorded against. The engine recomputes **forced advances** automatically, so most runner movements resolve correctly after a correction. However, explicit `runnerOutcomes` stored in subsequent `AT_BAT_RECORDED` intents may now describe outcomes that were based on a wrong base state. The scorer may need to re-record those intents (using Pattern 1) to reflect the corrected context. The UI should surface this when a correction causes a downstream ambiguity — specifically, when the recomputed base state entering an at-bat no longer matches the runners that the stored `runnerOutcomes` reference.

---

## 5. Layer 2: Game Engine (`game-engine.js`)

Pure functions that operate on Game Data types. No global state, no DOM, no localStorage.

### 5.1 Event Replay (Core)

Replay has two stages: resolve corrections, then fold.

```js
// Stage 1: build the effective stream — the raw stream with all VOID_EVENT
// targets removed. Returns a new array; does not modify the input.
// Events that void other events are themselves included (they have no effect on state).
export function resolveStream(events: GameEvent[]): GameEvent[]

// Stage 2: apply a single event to the current derived state.
// Core reducer: (GameState | null, GameEvent) => GameState
// Unknown event types return state unchanged (forward compatibility).
export function applyEvent(state: GameState | null, event: GameEvent): GameState

// Full replay: resolveStream, then fold with applyEvent.
export function replayEvents(events: GameEvent[]): GameState
```

`replayEvents` is the only entry point callers need. The two-stage split is exposed separately for testing.

The initial state (before any events) is `null`. `GAME_CREATED` is always the first event and produces the initial `GameState`.

**AT_BAT_RECORDED resolution**: within `applyEvent`, each `AT_BAT_RECORDED` event writes to the cell `(side, inning, playerIndex)` in the state, overwriting any prior value for that cell. After all events are applied, each cell holds the intent from its most recent event. This is last-write-wins per cell, not per stream position.

**HalfInning ordering**: `applyEvent` stores at-bats in a map keyed by `slot` (batting order position 0–8). `computeHalfInning` (Section 5.2) reads that map and processes at-bats in ascending slot order, which matches batting order. This is why late-recorded at-bats (Section 4.5, Pattern 3) slot into the correct inning position without any insertion logic.

**Lineup resolution per half-inning**: `applyEvent` snapshots the current `TeamState` when a new half-inning begins (on the first `AT_BAT_RECORDED` for that half-inning, or when `INNING_CHANGED` fires). This snapshot is passed to `computeHalfInning` as `lineupAtStart`, so the engine knows which player was in each slot during that half-inning — even if substitutions change the lineup in subsequent half-innings. In DH games, slot N with `defensivePos: null` is the DH; the engine treats them identically to any other batter for run-scoring purposes.

Replaying from scratch on every action is the default. For a typical 9-inning game (~60 events) this is negligible. See Section 9 for snapshot caching if needed.

### 5.2 Inning Computation (called internally by applyEvent)

These functions are also exported for use in runner-prompt planning (Section 5.3).

```js
// Recompute all derived fields for one half-inning.
// Called by applyEvent whenever an AT_BAT_RECORDED or AT_BAT_CLEARED event lands
// in that half-inning. Does not mutate input.
// lineupAtStart is the TeamState at the beginning of the half-inning, used to resolve
// which player occupies each batting slot (important after substitutions and in DH games
// where slot N may be a DH with no defensive position).
export function computeHalfInning(halfInning: HalfInning, lineupAtStart: TeamState): HalfInning

// Compute the base state immediately before a given player's at-bat in a half-inning.
// slot is the batting order index (0–8), not a player identity.
export function basesBeforeAtBat(halfInning: HalfInning, slot: number): BaseState

type BaseState = {
  first:  AtBat | null,  // at-bat record for runner currently on 1B
  second: AtBat | null,
  third:  AtBat | null,
  outs: number,
}

// Total outs recorded in a half-inning.
export function totalOuts(halfInning: HalfInning): number
```

### 5.3 Runner Prompt Planning

Called by the presentation layer *before* the scorer commits an at-bat, to determine which runner outcomes need user input.

```js
// Given a half-inning and a batter result code, identify which runner outcomes
// are deterministic (forced) and which require a prompt.
// Does not render anything; returns data only.
export function planRunnerPrompts(
  halfInning: HalfInning,
  playerIndex: number,
  result: BatterResultCode,
): RunnerPromptPlan

type RunnerPromptPlan = {
  forced: RunnerOutcome[],
  ambiguous: RunnerPromptQuestion[],
  extraOuts: number,
}

type RunnerPromptQuestion = {
  runnerStartBase: 1 | 2 | 3,
  runnerLabel: string,
  options: RunnerOutcomeOption[],
  defaultOption: RunnerOutcomeOption,
}

type RunnerOutcomeOption = {
  label: string,
  outcome: RunnerOutcome,
}
```

### 5.4 Statistics

Statistics are derived from `GameState` (the replay output), not from the event stream directly.

```js
// Batting line for one player across all innings.
export function computeBattingLine(state: GameState, side: 'away'|'home', playerIndex: number): BattingLine

type BattingLine = {
  ab: number, h: number, r: number, rbi: number, bb: number, k: number,
  avg: string,
}

// Per-inning stats for one side.
export function computeInningStats(state: GameState, side: 'away'|'home', inning: number): InningStats

type InningStats = {
  runs: number, hits: number, walks: number, errors: number, lob: number,
}

// Runs per inning for one side (for line score display).
export function computeLineScore(state: GameState, side: 'away'|'home'): number[]
```

### 5.5 Engine Contract

- All functions are **pure**: same inputs → same outputs, always.
- No function reads or writes `localStorage`, touches the DOM, or references any global variable.
- All functions return new objects; inputs are never mutated.
- `applyEvent` with an unrecognized event type returns state unchanged (forward compatibility).
- Error cases (impossible base states, malformed sequences) throw typed errors.

---

## 6. Layer 3: Presentation (`app.js` + `index.html`)

Handles user interaction, DOM rendering, and storage. The presentation layer never mutates game state directly: it appends events and lets the engine replay derive the new state.

### 6.1 App State

A single app-level state object replaces the current scattered globals:

```js
type AppState = {
  // Source of truth — only this is stored
  record: GameRecord | null,     // { version, id, events[] }

  // Derived — always a pure function of record.events; never stored
  gameState: GameState | null,

  // UI-only state — ephemeral, not stored
  view: 'away' | 'home',
  savedGamesIndex: GameSummary[],
  ui: {
    activeModal: 'atbat' | 'runners' | 'roster' | 'games' | null,
    atBatCtx: AtBatEditContext | null,
    runnerCtx: RunnerEditContext | null,
    rosterSide: 'away' | 'home',
  },
}
```

### 6.2 Dispatch

All game mutations go through `dispatch`. It appends an event to the stream, replays to get the new `GameState`, persists the updated stream, and re-renders.

```js
function dispatch(event: GameEvent): void {
  state.record.events.push(event)
  state.gameState = replayEvents(state.record.events)
  persistRecord(state.record)   // saves only the event stream
  render(state)
}
```

Undo is: `state.record.events.pop()` then replay. Because every prior state is recoverable from the stream, no additional snapshot is needed for single-step undo.

UI actions translate into events before calling dispatch:

```js
// Example: scorer saves an at-bat
function onAtBatSaved(side, inning, playerIndex, intent) {
  dispatch({ type: 'AT_BAT_RECORDED', side, inning, playerIndex, intent })
}

// Example: scorer corrects a previously entered at-bat
function onAtBatUpdated(side, inning, playerIndex, newIntent) {
  dispatch({ type: 'AT_BAT_RECORDED', side, inning, playerIndex, intent: newIntent })
  // engine handles overwrite: last AT_BAT_RECORDED for a given (side, inning, playerIndex) wins
}
```

### 6.3 Storage Adapter

Storage operates on `GameRecord` (the event stream), not on `GameState`:

```js
// storage.js
export function loadGamesIndex(): GameSummary[]
export function loadRecord(id: string): GameRecord | null
export function persistRecord(record: GameRecord): void
export function deleteRecord(id: string): void
export function exportRecord(record: GameRecord): string    // JSON for file download
export function importRecord(json: string): GameRecord      // parses + migrates if v1
```

### 6.4 Rendering

Render functions receive `AppState` (which already contains the replayed `GameState`) and produce DOM output. They never call the engine or storage directly.

```js
// render.js
export function render(state: AppState): void
export function renderScoreboard(gameState: GameState): void
export function renderGrid(gameState: GameState, ui: UIState): void
export function renderBatStats(gameState: GameState, side: 'away'|'home'): void
export function renderInningStats(gameState: GameState, side: 'away'|'home'): void
export function renderLineScore(gameState: GameState): void
```

The full render cycle:

```
dispatch(event)
  → append to record.events
  → replayEvents(record.events) → gameState
  → persistRecord(record)
  → render({ record, gameState, ui, ... })
       → renderScoreboard(gameState)
       → renderGrid(gameState, ui)
       → renderBatStats(gameState, view)
       → ...
```

---

## 7. Data Flow

```
User Action (e.g., "save at-bat", "correct a ruling", "void an event")
    │
    ▼
dispatch(event: GameEvent)                  ← app.js
    │
    ├── record.events.push(event)           ← append to stream (immutable history grows)
    │
    ├── replayEvents(record.events)         ← game-engine.js
    │       ├── resolveStream(events)       ← remove voided events → effective stream
    │       └── effectiveStream.reduce(applyEvent, null) → GameState
    │               ├── last-write-wins per (side, inning, playerIndex) cell
    │               └── computeHalfInning processes cells in batting order
    │
    ├── persistRecord(record)               ← storage.js
    │       └── writes only the raw event stream; derived state is never stored
    │
    └── render(state)                       ← render.js
            └── reads state.gameState (already computed); emits DOM; no engine calls
```

**Correction flows:**

```
Value correction (E→1B):
  dispatch(AT_BAT_RECORDED { ..., intent:{ result:'1B' } })
  → cell overwrites prior intent on replay; audit history preserved

Void (wrong event):
  dispatch(VOID_EVENT { seq: N })
  → resolveStream excludes events[N] from effective stream

Late entry (skipped at-bat):
  dispatch(AT_BAT_RECORDED { side, inning, playerIndex:3, intent })
  → cell appears in map; computeHalfInning processes it in batting order
```

**Key properties:**
- The raw event stream is the only persistent thing. It only ever grows.
- `GameState` is always a pure function of the effective stream (raw stream minus voids).
- Storage writes happen once per action, not on every render.
- Undoing the last appended event: `record.events.pop()` + replay + re-render (only valid before persist; after persist, correct with a new event instead).

---

## 8. Migration Plan

### Phase 0: Toolchain

1. Add `package.json` with `vite`, `typescript`, and `vitest` as devDependencies.
2. Add `tsconfig.json` (see Section 10.4).
3. Confirm `vite dev` serves the existing `index.html` unchanged — no app code moves yet.
4. Add `"dev": "vite"`, `"build": "vite build"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest"` scripts.

### Phase 1: Extract and test the engine

1. Create `src/types.ts` with all types from Sections 4.1–4.3.
2. Create `src/game-engine.ts`. Port `recomputeInning`, `basesBeforeAtBat`, `planRunnerQuestions`, and `RESULTS` directly, typed, accepting explicit parameters instead of reading from global `G`.
3. Write `applyEvent` as a typed switch on `GameEvent.type` with an exhaustive `never` default.
4. Write `replayEvents` as `resolveStream(events).reduce(applyEvent, null)`.
5. Write `resolveStream` to filter voided events.
6. Write unit tests in `src/game-engine.test.ts` against the worked examples in `docs/SCORING_RULES.md`.
7. Verify all tests pass and `tsc --noEmit` is clean before touching `index.html`.

### Phase 2: Extract the data layer

1. Define event types and play data types in `game-data.js`.
2. Write `migrateFromV1`: converts the legacy `plays` map into a synthetic `GameRecord` with `version: 2`. The synthetic stream has one `GAME_CREATED` event, `PLAYER_SET` events for each player, and `AT_BAT_RECORDED` events ordered by inning then batting order.
3. On load: if stored data has no `version` field (or `version: 1`), run migration before replay.

### Phase 3: Extract storage

1. Move all `localStorage` calls into `storage.js`.
2. Change the storage contract: save `GameRecord` (the event stream), not the derived game state.
3. Remove `persist()` from `render()` in `index.html`.
4. Call `persistRecord()` explicitly inside `dispatch`, after replay.

### Phase 4: Refactor presentation

1. Replace global variables (`G`, `view`, `abCtx`, `runCtx`) with `AppState`.
2. Replace all direct state mutations with `dispatch(event)` calls.
3. Convert render functions to read from `state.gameState` (the replayed projection).
4. Split `index.html` into `index.html` (shell) + `app.js`.

### Phase 5: Extend the model

With the separation in place, new event types can be added without touching scoring logic or rendering:
- `PITCH_RECORDED` events for pitch-count tracking
- `BETWEEN_PITCH_RECORDED` for steals, wild pitches, balks
- Full `FieldingSequence` in `AT_BAT_RECORDED` for fielding stats
- New game formats (extra innings, mercy rule, no DH) via engine rule variants
- Export to Retrosheet format by projecting the event stream

---

## 9. Open Questions

1. **Replay performance and snapshots**: Replaying from scratch on every action is O(N) in the number of events. For a typical 9-inning game (~60 events) this is negligible. If it becomes a concern, an optional snapshot cache can store a `(eventIndex, GameState)` pair and replay only from that checkpoint forward. This is an optimization, not a correctness concern.

2. **Cascade detection after corrections**: When a correction changes an early at-bat, downstream `runnerOutcomes` may reference a base state that no longer exists. The engine can detect this by comparing the base state it computes entering each at-bat against the `startBase` values in the stored `runnerOutcomes`. Decide: should the engine silently drop orphaned runner outcomes (safest), raise an error (strict), or flag the affected cells in `GameState` so the UI can prompt re-entry (most helpful)? The recommended approach is to flag and prompt.

3. **Audit history in the UI**: Last-write-wins means the raw stream contains the full correction history (old and new intents), but `GameState` only reflects the current effective state. Decide whether the UI should expose that history — e.g., a cell tooltip showing "was E/6, corrected to 1B" — for post-game review or dispute resolution.

4. **Storage backend**: The current localStorage backend limits to ~5 MB and has no query capability. The event stream is append-only and naturally grows; IndexedDB would allow larger datasets. The `storage.ts` adapter is designed to make this swap transparent.

5. **Backward compatibility for existing saved games**: The `migrateFromV1` path must handle every game saved by the current app. The v1 `adv` map stores runner outcomes as `{ fromBase: toBase | "out" }` without ordering. The migration must reconstruct `outSequence` heuristically (or leave it absent) since the original recording order is not preserved.

---

## 10. TypeScript Plan

TypeScript is adopted. The types in Sections 4.1–4.3 are TypeScript — they appear in `.ts` source files, not as documentation annotations.

### 10.1 Rationale

The event stream and correction model contain enough structural complexity that type-checking at module boundaries catches real bugs:

- A switch on `GameEvent.type` that misses a new event variant silently returns wrong state in JS; in TypeScript an exhaustive check makes it a compile error.
- The `HalfInning.atBats` map is sparse (`playerIndex` may have no entry for a given inning); `noUncheckedIndexedAccess` forces callers to handle `AtBat | undefined` rather than assuming presence.
- `RunnerOutcome.startBase` and `endBase` are constrained integers; TypeScript prevents mixing them with raw player indices or inning numbers.
- The boundary between stored intent and derived state (both fields on `AtBat`) is enforced by type — nothing in `game-data.ts` or `game-engine.ts` can accidentally conflate the two.

### 10.2 Toolchain: Vite

**Vite** is the build tool.

- Provides the dev server that ES modules (`import`/`export`) require — removing the `file://` constraint without adding a complex build pipeline.
- TypeScript support is built in: Vite strips types at build time (fast) while `tsc --noEmit` handles type checking separately.
- `index.html` remains the entry point: `<script type="module" src="./src/app.ts">` is all the wiring needed.
- `vite build` produces a self-contained `dist/` suitable for static hosting.
- Zero-config for the simple case; `vite.config.ts` only needed if the defaults need adjusting.

```
devDependencies:
  vite
  typescript
  vitest          (test runner — see 10.3)
```

No framework, no other dependencies. The existing vanilla DOM rendering approach is unchanged.

### 10.3 Test Harness: Vitest

**Vitest** is the test runner. It is Vite-native (shares the same config and TypeScript pipeline), supports ES modules natively, and requires zero additional setup once Vite is added. Tests live in `src/__tests__/` or alongside their modules as `*.test.ts`.

The engine is pure, so tests are straightforward:

```typescript
import { replayEvents } from '../game-engine'
import { describe, it, expect } from 'vitest'

describe('replayEvents', () => {
  it('scores a run on a home run with runner on first', () => {
    const events = [
      { type: 'GAME_CREATED', id: 'test', date: '2026-01-01', awayName: 'A', homeName: 'H' },
      { type: 'AT_BAT_RECORDED', side: 'away', inning: 1, playerIndex: 0,
        intent: { result: '1B' } },
      { type: 'AT_BAT_RECORDED', side: 'away', inning: 1, playerIndex: 1,
        intent: { result: 'HR' } },
    ]
    const state = replayEvents(events)
    expect(state.away.innings[0].atBats[1].derived.run).toBe(true)
    expect(state.away.innings[0].atBats[1].derived.rbi).toBe(2)
  })
})
```

### 10.4 tsconfig

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",  // Vite-compatible
    "lib": ["ES2022", "DOM"],

    // Strict baseline
    "strict": true,                         // enables all strict flags
    "noUncheckedIndexedAccess": true,       // atBats[n] → AtBat | undefined
    "exactOptionalPropertyTypes": true,     // ? means absent, not undefined
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,

    // Build behavior
    "isolatedModules": true,                // required for Vite's transpile-only mode
    "skipLibCheck": true,
    "noEmit": true                          // Vite emits; tsc is type-check only
  },
  "include": ["src"]
}
```

### 10.5 Key Type System Features

**Discriminated unions for events**

`GameEvent` is a union discriminated on `type`. TypeScript narrows automatically inside `switch` cases. The `applyEvent` default branch uses `never` to make missing cases a compile error:

```typescript
function applyEvent(state: GameState | null, event: GameEvent): GameState {
  switch (event.type) {
    case 'GAME_CREATED':           return handleGameCreated(event)
    case 'AT_BAT_RECORDED':        return handleAtBatRecorded(state!, event)
    case 'AT_BAT_CLEARED':         return handleAtBatCleared(state!, event)
    case 'VOID_EVENT':             return state!   // handled by resolveStream
    case 'NOTE':                   return state!
    // … all variants …
    default: {
      const _exhaustive: never = event  // compile error if a new variant is unhandled
      return state!
    }
  }
}
```

Adding a new event variant to `GameEvent` immediately produces a type error in `applyEvent` until the case is handled.

**Sparse map access**

`HalfInning.atBats` is typed as `Record<number, AtBat>` (or `{ [playerIndex: number]: AtBat }`). With `noUncheckedIndexedAccess`, every access returns `AtBat | undefined`, forcing the engine to guard before use:

```typescript
const ab = halfInning.atBats[playerIndex]
if (ab === undefined) return  // player hasn't batted this inning
```

This catches the real bug where `computeHalfInning` iterates over a roster index that skipped an inning.

**Branded integers for bases and positions**

Optional but high-value: branded types prevent mixing base numbers and fielder position numbers, which are both integers but semantically distinct:

```typescript
type Base     = 0 | 1 | 2 | 3 | 4
type Position = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// Without branding, this compiles silently — a real scoring bug:
const outcome: RunnerOutcome = { startBase: 6, endBase: 1 }  // 6 is a Position, not a Base

// TypeScript's literal union types catch this without needing full nominal branding.
```

**Readonly event records**

Events are immutable once appended. Enforce it at the type level:

```typescript
type GameRecord = {
  readonly version: 2,
  readonly id: string,
  readonly events: readonly GameEvent[],
}
```

`dispatch` appends by creating a new array (`[...record.events, event]`) rather than mutating in place, which the `readonly` constraint enforces.

### 10.6 Type Organization

All shared types live in `src/types.ts`. Each module imports only what it needs.

```
src/
├── types.ts         GameEvent, GameState, AtBatIntent, RunnerOutcome, …
├── game-data.ts     imports types; exports constructors, serialization, migration
├── game-engine.ts   imports types; exports applyEvent, replayEvents, computeHalfInning, …
├── storage.ts       imports types; exports persistRecord, loadRecord, …
├── render.ts        imports types; exports render, renderGrid, …
├── app.ts           imports all; owns AppState, dispatch
└── index.html       <script type="module" src="./app.ts">
```

Nothing in `game-engine.ts` or `game-data.ts` imports from `app.ts`, `render.ts`, or `storage.ts`.

### 10.7 TypeScript Migration Sequence

TypeScript is introduced at the start of Phase 1 (engine extraction), not retrofitted afterward. This avoids a double migration (JS → modules → TS).

1. **Phase 0 (before any refactoring)**: add `package.json`, `vite`, `typescript`, `vitest`; add `tsconfig.json`; confirm `vite dev` serves the existing `index.html` unchanged.
2. **Phase 1**: write `src/types.ts` and `src/game-engine.ts` in TypeScript from the start. Port the existing engine logic directly, typed. Write tests in `game-engine.test.ts`.
3. **Phase 2**: write `src/game-data.ts` in TypeScript.
4. **Phase 3**: write `src/storage.ts` in TypeScript.
5. **Phase 4**: write `src/app.ts` and `src/render.ts` in TypeScript; remove the old inline scripts from `index.html`.

At no point is there a mixed JS/TS phase in the same module. Each new file is TypeScript from creation.
