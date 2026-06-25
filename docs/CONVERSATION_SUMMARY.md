# Development Log

This document summarizes how Scorebook was built, capturing the requirements and the
sequence of design decisions — especially the baserunning logic, which was refined
over several iterations. It is meant as orientation for whoever picks up the code.

## Original requirements

The app was specified to:

1. Run on macOS, iOS, Android, Windows, and Linux.
2. Create, save, and restore games entirely locally.
3. Let player names, numbers, and positions be entered as the game progresses.
4. Look like a traditional paper baseball scorecard.
5. Work offline.
6. Keep typical in-game per-player and per-inning statistics.

## Architectural choice

A single self-contained `index.html` (HTML + CSS + vanilla JS, no dependencies) was
chosen because it satisfies cross-platform, offline, and zero-install needs at once:
any browser on any OS can open it, and there are no network calls. Persistence uses
`localStorage`; games can be exported/imported as JSON.

The scorecard is a batting-order × innings table. Each at-bat cell renders an SVG
diamond. Stats (per batter AB/H/R/RBI/BB/K/AVG, per-inning runs/hits, line score)
are derived live from the recorded plays.

## Key design principle: store intent, derive display

Rather than storing each runner's final position directly, the app stores the
*author's intent* per at-bat (the result code, the batter's own hit distance, any
explicit placements, and explicit per-runner outcomes). All display values — what
base each runner ended on, who scored, RBI counts — are **recomputed** from scratch
whenever anything changes. This keeps edits consistent: changing an earlier at-bat
correctly cascades through the rest of the inning. The recompute is also re-run when a
game is loaded or imported, which doubles as backward-compatibility for older saves.

## The diamond base paths

The diamond was changed from a single bordered square to four individually styled SVG
legs so that **traversed** base paths read darker (solid, accent color, with the
reached bases filled) while **untraversed** legs are light and dotted. Empty cells
still show the faint dotted diamond so the blank card looks like real scorecard paper.

## Baserunning: the hard part

This logic was refined through several rounds until it matched real scorekeeping.

### Iteration 1 — forced advancement on reaching base
When a batter reached base, runners were pushed ahead. First attempt forced any runner
whose bases-behind were all occupied, advancing each **one** base.

### Iteration 2 — multi-base hits
A double should force runners more than one base. Advance distance was tied to the
batter's hit (double = 2, triple = 3).

### Iteration 3 — what "forced" really means
The correct definition: *a runner is forced only when the runner immediately behind
them (ultimately the batter) needs their base.* The force is a chain of occupied bases
back to the batter that **breaks at the first empty base**. With men on 2nd and 3rd
but 1st empty, neither runner is forced.

### Iteration 4 — base-by-base resolution (final model)
The decisive insight: resolve the force **base by base as the batter advances**, not
as a single snapshot. The batter steps from 1st up to their hit base; each time the
batter *enters* an occupied base, that runner is forced ahead one base, and that push
cascades forward if the next base is also occupied.

Worked example — runners on 2nd and 3rd, batter doubles:
- Batter reaches 1st: 1st was empty, nobody is forced.
- Batter advances to 2nd: now needs 2nd (occupied) → runner on 2nd forced to 3rd →
  3rd occupied → runner on 3rd forced home (scores).

Result: runner from 3rd scores, runner from 2nd to 3rd, batter on 2nd — a standard
one-run double. The same situation on a *single* forces no one (the batter never
reaches the runners), which is also correct.

This is implemented in `recomputeInning` via a recursive `pushFrom(base)` that clears
a base by forcing its runner (and any chain ahead) up one, called once for each base
the batter passes through.

### Unforced advances stay manual
Runners the batter does **not** force (e.g. a man on 2nd when the batter singles) are
never auto-advanced, because whether they take the extra base is the scorer's
judgment. Those are captured by the runner-prompt flow below.

## Double and triple plays

A `DP` (and `TP`) result code was added. The batter is out and additional forced
runners are retired. Rather than guessing the rest, this fed into a general solution:

## Guided per-runner prompts (final UX)

After choosing a result, if any runner's outcome is ambiguous, the app shows a
"What about the runners?" step. It asks about each ambiguous runner **lead-first**
(3rd, then 2nd, then 1st, because a lead runner's fate frees bases for trailing ones),
offering only legal outcomes (Out / Hold / To a specific base / Score) with a
**pre-selected likely default** the user simply confirms.

- **Forced runners are resolved silently** — the user is only asked about genuinely
  open calls (unforced movers and the extra outs on a DP/TP). This was an explicit
  product decision to keep the common case fast.
- **DP defaults encode the textbook play.** For a 6-4-3 with men on 1st and 2nd, the
  prompt defaults the runner on 2nd to "To 3rd" and the runner on 1st to "Out," so the
  standard double play is a single confirm. Either can be changed if the play differed
  (e.g. the runner scored, or the lead runner was the one retired).

The chosen outcomes are stored on the at-bat as an `adv` map (`{ fromBase: targetBase
| "out" }`) and applied by the recompute engine after forces are resolved. Because
this is just data layered on top of the deterministic force engine, edits and replays
remain consistent.

## Functions worth knowing

- `recomputeInning(side, inn)` — replays an inning in batting order, applying forces
  (base-by-base) then explicit `adv` outcomes; derives base/run/rbi for every cell.
- `basesBeforeAtBat(side, inn, pi)` — replays earlier at-bats to get the base state
  immediately before a given batter, used to plan runner questions.
- `planRunnerQuestions(side, inn, pi, code)` — determines which runners are forced
  (and thus silent) vs. ambiguous, and builds the question list with options and
  defaults.
- `RESULTS` — the catalog of result codes (hits, outs, on-base, DP/TP) with their
  hit distance and metadata.

## Known limitations / next steps

- Batting and baserunning are modeled; pitching and fielding stats are not yet.
- Storage is `localStorage` (per-browser, size-limited) — IndexedDB is the natural
  upgrade.
- No automated tests yet, though the worked examples above translate directly into
  unit tests once the engine is extracted into its own module.
- Not yet a PWA; adding a manifest + service worker would enable home-screen install
  and self-caching.
