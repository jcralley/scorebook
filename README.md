# Scorebook — Digital Baseball Scorecard

A single-file, offline-first baseball scorecard that runs in any modern browser on
macOS, iOS, Android, Windows, and Linux. Games are created, scored, saved, and
restored entirely on-device. The card mirrors a traditional paper scorecard — a
batting-order × innings grid with diamond cells — and keeps live per-player and
per-inning statistics.

## Status

Working prototype. The entire application currently lives in `src/index.html`
(HTML + CSS + vanilla JavaScript, no build step, no dependencies). It is ready to
be opened directly or served as a static file, and is structured so it can grow
into a packaged product.

## Quick start

Open the file directly:

```
open src/index.html          # macOS
xdg-open src/index.html       # Linux
start src\index.html          # Windows
```

Or serve it locally (recommended, so storage and future PWA features behave like
production):

```
cd src
python3 -m http.server 8000
# visit http://localhost:8000
```

No install, no network connection required after the page loads.

## Features

- **Cross-platform.** Plain HTML/CSS/JS; runs in Safari, Chrome, Edge, and Firefox
  on every major desktop and mobile OS.
- **Fully offline.** No network calls anywhere in the app.
- **Local persistence.** Every play auto-saves to `localStorage`. A Games menu lists
  saved games to reopen or delete, with JSON Export/Import for backup and transfer.
- **Live roster entry.** Player number, name, and position are entered inline in the
  grid or via the Lineups sheet, and can be added or edited as the game progresses.
- **Traditional scorecard look.** Ink-on-cream styling, diamond at-bat cells whose
  base paths fill in as runners advance (untraversed legs dotted, traversed legs
  solid), a batting-order grid, a line score, and a scoreboard strip.
- **In-game stats.** Per batter: AB, H, R, RBI, BB, K, AVG. Per inning: runs and
  hits. Plus team totals and a full line score, all updating live.
- **Automatic baserunning.** Forced advances are resolved automatically using a
  base-by-base model (see `docs/SCORING_RULES.md`). Ambiguous outcomes — unforced
  runners, runners taking extra bases, and double/triple plays — trigger a guided
  per-runner prompt with sensible pre-selected defaults.

## How to score a play

1. Tap any at-bat box in the grid.
2. Choose the result (1B–HR, K, GO, BB, DP, TP, etc.).
3. Tap **Save**. If any runner's fate is ambiguous, a "What about the runners?"
   step appears, asking about each runner lead-first with a likely default
   pre-selected. Confirm or adjust, then save.
4. Tap the "Inning" pill to advance the half-inning.

## Repository layout

```
scorebook/
├── README.md                  This file
├── src/
│   └── index.html             The complete application (single file)
└── docs/
    ├── CONVERSATION_SUMMARY.md Development log: how the app was built and why
    └── SCORING_RULES.md        The baserunning / force-advance rules, with examples
```

## Data model (for future work)

A game is a JSON object:

```jsonc
{
  "id": "string",
  "date": "ISO-8601",
  "away": { "name": "string", "roster": [ { "num": "", "name": "", "pos": "" } ] },
  "home": { "name": "string", "roster": [ ... ] },
  "inning": 1,
  "half": "top",
  "plays": {
    "away": { "<playerIndex>": { "<inning>": <cell> } },
    "home": { ... }
  }
}
```

A **cell** records one at-bat. The author's intent is stored; display values
(`base`, `run`, `rbi`) are *derived* on every recompute so edits stay consistent:

```jsonc
{
  "code": "1B",          // result code (see RESULTS table in source)
  "hit": 1,              // bases earned by the batter's own action
  "endBase": 1,          // base the user explicitly placed the batter at
  "manualRbi": 0,        // RBI entered by the user for this at-bat
  "adv": { "2": 3, "1": "out" },  // explicit per-runner outcomes (target base or "out")
  // derived (recomputed, not authoritative):
  "base": 1, "run": false, "rbi": 0
}
```

Persistence keys in `localStorage`: `sb_games_index`, `sb_game_<id>`, `sb_current`.

## Suggested roadmap toward a product

- **Extract the engine.** Move scoring/baserunning logic out of `index.html` into an
  ES module (`src/engine.js`) with no DOM dependencies, so it can be unit-tested and
  reused. The functions to lift: `recomputeInning`, `basesBeforeAtBat`,
  `planRunnerQuestions`, plus the `RESULTS` table.
- **Add a test suite.** The development log contains worked examples that map
  directly to unit tests (forced advances, doubles, double plays). Wire them into a
  runner like Vitest or node:test.
- **Make it a PWA.** Add a web app manifest and a service worker so it installs to the
  home screen and caches itself for true offline use.
- **Storage upgrade.** `localStorage` is per-browser and size-limited. Move to
  IndexedDB for larger histories and structured queries; keep the JSON
  export/import for portability.
- **Pitching & fielding stats.** The model currently centers on batting/baserunning.
  Add pitch counts, pitching lines, and fielding/error tracking.
- **Box score & sharing.** Generate a printable box score and a shareable game file
  or link.

## License

Add a license of your choice (e.g. MIT) before distributing.
