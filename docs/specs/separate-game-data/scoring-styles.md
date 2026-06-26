# Baseball Scorecard Notation: Scoring Style Analysis

This document surveys paper scorecard notation traditions and enumerates the complete field of possible pitch and play outcomes. It serves as the primary reference for defining the data model in the game-data / engine separation.

---

## 1. Fielder Position Numbers

All notation systems share the standard numbering:

| # | Position       |
|---|----------------|
| 1 | Pitcher        |
| 2 | Catcher        |
| 3 | First Baseman  |
| 4 | Second Baseman |
| 5 | Third Baseman  |
| 6 | Shortstop      |
| 7 | Left Field     |
| 8 | Center Field   |
| 9 | Right Field    |

---

## 2. Paper Scorecard Traditions

### 2.1 Diamond-Based Systems (most common)

Each at-bat cell contains a small diamond representing the bases. The scorer draws through the diamond's legs to show a runner's path and fills in the diamond when a run scores. Variations:

- **Solid line** = runner advanced safely
- **Dotted/dashed line** = runner left on base or was stranded
- **Filled diamond** = run scored
- **X through a base corner** = out made at that base

Symbols are overlaid on the diamond to record how the batter reached or was retired (e.g., `K`, `BB`, `6-3`, `HR`).

### 2.2 Traditional Box-Score Notation

Associated with how official scorers report to newspapers and statistical services. Emphasizes the final result per at-bat (AB, H, R, RBI, BB, SO). Does not capture inning-level sequence or runner paths—purely summative.

### 2.3 Project Scoresheet / Retrosheet

Developed in the 1980s for reconstructing complete play-by-play from scoresheets. Key properties:

- Every pitch is logged (ball, strike, foul, etc.)
- Every runner movement is fully specified with explicit base destinations
- Fielding sequences use a standardized delimiter (`/`) to separate modifiers
- Examples: `S7/G`, `K/C`, `FC6/G`, `8/F`, `64(1)3/GDP`

This system is the most complete and unambiguous but requires significant training and time per at-bat. It underpins Retrosheet's historical game files.

### 2.4 Sports Information Directors of America (SIDA/CoSIDA)

Standard used by NCAA college sports. Functionally similar to traditional notation with a defined set of abbreviations for official statistics. Less pitch-level granularity than Project Scoresheet.

### 2.5 Personal / Regional Variants

Widespread variation exists among recreational and broadcast scorers. Common divergences:

- Using `GO` for groundout vs. full fielding sequences (`6-3`)
- `F` prefix for flyouts (`F8`) vs. bare number (`8`)
- `L` vs. `LD` for line drives
- `Kc` vs. backward-K for called third strike
- Color-coding hits (red) vs. outs (black/pencil)

---

## 3. The Complete Field of Pitch Outcomes

These are the possible results of an individual pitch, before the ball is put in play.

### 3.1 Non-Contact Pitch Results

| Code | Name              | Count Change           | Notes                                              |
|------|-------------------|------------------------|----------------------------------------------------|
| `B`  | Ball              | +1 ball                | 4th ball = walk (BB)                               |
| `S`  | Called strike     | +1 strike              | 3rd = strikeout looking (Kc / ꓘ)                  |
| `S`  | Swinging strike   | +1 strike              | 3rd = strikeout swinging (K)                       |
| `F`  | Foul ball         | +1 strike if < 2       | With 2 strikes: no change (unless foul tip/bunt)  |
| `T`  | Foul tip          | +1 strike              | Counts in all counts; catcher catch = strikeout    |
| `BF` | Foul bunt         | +1 strike              | With 2 strikes = strikeout                         |

### 3.2 Pitch Results That End the At-Bat Without Ball in Play

| Code      | Name                    | Notes                                                        |
|-----------|-------------------------|--------------------------------------------------------------|
| `BB`      | Walk                    | 4 balls; batter takes 1B                                     |
| `IBB`     | Intentional walk        | 4 intentional balls; sometimes signaled without pitches      |
| `HBP`     | Hit by pitch            | Pitch hits batter; batter takes 1B                           |
| `K+WP`    | Dropped 3rd + wild pitch| Catcher can't hold 3rd strike; batter may run to 1B          |
| `K+PB`    | Dropped 3rd + passed ball| Same as above; catcher error vs. pitcher error distinction  |
| `CI`      | Catcher's interference  | Catcher's glove contacts bat; batter awarded 1B              |

---

## 4. The Complete Field of Ball-in-Play Outcomes

### 4.1 Batted Ball Types (modifiers on all in-play results)

| Code | Type        | Notes                                              |
|------|-------------|---------------------------------------------------|
| (none) | Ground ball | Ball rolls or bounces on the infield              |
| `F`  | Fly ball     | High arc to outfield                              |
| `L`  | Line drive   | Sharply hit, nearly horizontal trajectory         |
| `P`  | Pop fly      | High arc to infield or shallow outfield           |
| `B`  | Bunt         | Intentionally short hit; includes drag bunts      |
| `IF` | Infield fly  | Pop fly meeting Infield Fly Rule conditions       |

### 4.2 Batter Outcomes: Reaching Base

| Code  | Name                    | How batter reaches                                                   |
|-------|-------------------------|----------------------------------------------------------------------|
| `1B`  | Single                  | Batted ball; batter reaches first safely                             |
| `2B`  | Double                  | Batted ball; batter reaches second safely                            |
| `3B`  | Triple                  | Batted ball; batter reaches third safely                             |
| `HR`  | Home Run                | Batter (and all runners) score; over-fence or inside-the-park        |
| `IPHR`| Inside-the-park HR      | Ball stays in play; batter circles all bases                         |
| `GRD` | Ground rule double      | Ball leaves play after one bounce; batter gets 2B                   |
| `E#`  | Reached on error        | Fielder error allows batter to reach; `#` = fielder position         |
| `FC`  | Fielder's choice        | Fielder retires a different runner; batter reaches first             |
| `DRP` | Dropped 3rd strike      | Catcher fails to hold; batter runs; credited as strikeout            |

### 4.3 Batter Outcomes: Out

| Code    | Name                    | How out is recorded                                                 |
|---------|-------------------------|---------------------------------------------------------------------|
| `K`     | Strikeout swinging      | 3rd strike, batter swings                                           |
| `Kc`    | Strikeout looking       | 3rd strike, called; often written as backward K (ꓘ)                |
| `GO`    | Groundout               | Ground ball fielded; batter thrown out at 1B (e.g., `6-3`)         |
| `FO`    | Flyout                  | Fly ball caught in the air (e.g., `F8`, `8`)                       |
| `LO`    | Line out                | Line drive caught in the air (e.g., `L6`, `LD4`)                   |
| `PO`    | Pop out                 | Pop fly caught in the air (e.g., `P5`, `P2`)                       |
| `SH`    | Sacrifice bunt          | Batter bunts, put out at 1B, runner(s) advance; no AB charged       |
| `SF`    | Sacrifice fly           | Fly ball caught, runner scores from 3B; no AB charged               |
| `IFF`   | Infield fly             | Automatic out called; runners may not advance                       |

### 4.4 Double Plays and Triple Plays

Multiple outs recorded on a single batted ball. The notation must capture the **type of batted ball** and the **ordered sequence of fielders** who recorded each out. See Section 6 for full ordering rules.

| Code     | Name                   | Example sequence | Description                                              |
|----------|------------------------|------------------|----------------------------------------------------------|
| `DP`     | Double play (generic)  | `6-4-3`          | Two outs; most common on ground balls                    |
| `GDP`    | Grounded into DP       | `6-4-3`          | Specifically a ground ball DP                            |
| `LDP`    | Lined into DP          | `L6-3`           | Line drive caught; throw doubles off runner              |
| `FDP`    | Fly ball DP            | `F9-2`           | Catch + throw home to retire tagging runner              |
| `TP`     | Triple play            | `L5-4-3`         | Three outs; extremely rare                               |
| `UTP`    | Unassisted triple play | `U4`             | Single fielder records all three outs                    |

---

## 5. Between-Pitch Plays (Baserunning Without Batter Action)

These plays occur between or during pitches, affecting base runners but not the batter's count or result.

### 5.1 Baserunner Advances

| Code   | Name                    | Description                                                            |
|--------|-------------------------|------------------------------------------------------------------------|
| `SB#`  | Stolen base             | Runner steals; `#` = base stolen (SB2, SB3, SBH for home)             |
| `WP`   | Wild pitch              | Pitcher's errant throw; runners may advance; scored on pitcher          |
| `PB`   | Passed ball             | Catcher fails to hold; runners may advance; scored on catcher           |
| `BK`   | Balk                    | Illegal pitcher motion; all runners advance one base                   |
| `DI`   | Defensive indifference  | Catcher makes no throw; runner advances; no SB credit                  |
| `ADV`  | Runner advances (misc)  | Advances on error, overthrow, or other non-pitch event                 |
| `OBS`  | Obstruction             | Fielder blocks runner illegally; runner awarded base(s)                |

### 5.2 Baserunner Outs

| Code   | Name                    | Description                                                            |
|--------|-------------------------|------------------------------------------------------------------------|
| `CS#`  | Caught stealing         | Runner thrown out attempting to steal; `#` = base (CS2, CS3, CSH)     |
| `PKO`  | Pickoff                 | Pitcher/catcher throws to base; runner tagged out off bag              |
| `OA`   | Out advancing           | Runner thrown out trying to take extra base (not on a steal attempt)   |
| `RO`   | Rundown out             | Runner caught between bases; sequence of fielders listed               |
| `INT`  | Runner interference     | Runner impedes fielder; runner called out                              |

### 5.3 Modifying Events (affect runners, recorded separately)

| Code   | Name             | Description                                                               |
|--------|------------------|---------------------------------------------------------------------------|
| `E#`   | Error on play    | Fielding error allows runner to advance further than otherwise             |
| `T`    | Throwing error   | Specifically a throw that goes awry; subtype of `E#`                      |

---

## 6. Multi-Touch Play Notation and Ordering

This is the crux of encoding fielding sequences. The notation must unambiguously capture **what type of contact** the ball made, **which fielder touched it first**, and **the ordered chain of throws and putouts** that followed.

### 6.1 The Fielding Sequence

A fielding sequence is a dash-separated list of fielder numbers, read left to right in chronological order:

```
6-4-3
```

- `6` = Shortstop fielded the batted ball
- `4` = Second baseman received the throw and recorded the putout (force out)
- `3` = First baseman received the throw and recorded the putout (batter out)

Each number represents **one putout**. The dashes represent throws. A sequence of N numbers means N−1 throws were made and N putouts recorded (one per touch in order).

### 6.2 Batted Ball Type Prefixes

The absence of a prefix implies a ground ball. Prefixes signal the trajectory:

| Prefix | Meaning     | Example  | Reading                                         |
|--------|-------------|----------|-------------------------------------------------|
| (none) | Ground ball | `6-3`    | Grounder to SS, throw to 1B                     |
| `F`    | Fly ball    | `F8`     | Fly caught by CF                                |
| `L`    | Line drive  | `L6`     | Line drive caught by SS                         |
| `P`    | Pop fly     | `P5`     | Pop up caught by 3B                             |
| `B`    | Bunt        | `B13`    | Bunt fielded by pitcher, throw to 1B            |

When a prefix is present, the **first fielder number in the sequence caught the ball in the air**—the out is recorded by the catch itself, not by a throw to a base. All subsequent numbers still represent throw-and-putout in order.

### 6.3 Critical Distinction: Ground Play vs. Line Drive Play

Consider two double plays that both involve the SS and 1B:

**`6-4-3` (ground ball double play)**
```
Ball on the ground → SS fields it → throws to 2B (force out, runner from 1B) → 2B throws to 1B (force out, batter-runner)
Outs in order: 2B first, then 1B
```

**`L6-3` (line drive double play)**
```
Line drive → SS catches it in the air (first out) → SS throws to 1B (batter-runner doubled off, second out)
Outs in order: SS catch first, then 1B tag
```

These are structurally different:
- In `6-4-3`, the **first out** is a force at 2B on the baserunner; the **second out** is at 1B on the batter.
- In `L6-3`, the **first out** is the catch at SS; the **second out** is a tag (or force) at 1B on the retreating runner.
- The runner involved in each out is **different** in both plays.

### 6.4 Unassisted Putouts

When a fielder records a putout without a throw—catching a fly ball, stepping on a base for a force, or tagging a runner—and is the only fielder involved, the number stands alone:

| Notation | Meaning                                                  |
|----------|----------------------------------------------------------|
| `3`      | First baseman catches a pop fly unassisted               |
| `4U`     | Second baseman makes unassisted force out at 2B (some styles use `U` suffix) |
| `U3`     | Unassisted putout at first (3B fields grounder, steps on 1B) |

### 6.5 Unassisted Double Plays

When one fielder records both outs:

```
L4  →  Second baseman catches liner, then steps on 2B to double off the runner
```

Some notations write this as `4U(1)` (4 catches, unassisted retires runner at 2B) or simply `L4` with the context that the runner on 2B was doubled off. The format varies; the data model must allow tagging which runners were retired in which order.

### 6.6 Rundowns

A rundown involves a sequence of throws between fielders while a runner is caught between bases. The sequence lists all fielders who handled the ball in order:

```
2-5-2  →  Catcher throws to 3B, 3B throws back to catcher, catcher tags runner
```

The putout is recorded by the **last fielder** in the sequence.

### 6.7 Complete Multi-Out Notation Examples

| Notation     | Play Description                                                              |
|--------------|-------------------------------------------------------------------------------|
| `6-3`        | Grounder to SS, throw to 1B — batter out                                     |
| `6-4-3`      | Grounder to SS → 2B (force) → 1B (force) — classic GDP                       |
| `4-6-3`      | Grounder to 2B → SS (force) → 1B (force) — 2B side GDP                       |
| `5-4-3`      | Grounder to 3B → 2B (force) → 1B (force) — 3B side GDP                       |
| `3-6-3`      | Grounder to 1B → SS covering 2B (force) → 1B (force) — "around the horn"     |
| `1-6-3`      | Grounder to pitcher → SS covering 2B (force) → 1B (force)                   |
| `L6-3`       | Liner caught by SS → throw to 1B (runner doubled off)                        |
| `L4-3`       | Liner caught by 2B → throw to 1B (runner doubled off)                        |
| `L5-4`       | Liner caught by 3B → throw to 2B (runner doubled off 2B)                    |
| `F8-4`       | Deep fly caught by CF → throw to 2B (runner tagged out)                     |
| `F9-2`       | Fly caught by RF → throw home (runner from 3B tagging, thrown out)           |
| `L5-4-3`     | Liner to 3B (catch) → 2B (runner off 2B) → 1B (runner off 1B) — triple play |
| `2-5-2`      | Rundown between 3B and home — catcher tags out                               |
| `U3`         | First baseman fields grounder, steps on 1B unassisted                        |

---

## 7. Comprehensive Outcome Taxonomy

This taxonomy enumerates every event the data model must be able to represent.

```
PlayOutcome
├── PitchResult (individual pitch, within at-bat)
│   ├── Ball
│   ├── CalledStrike
│   ├── SwingingStrike
│   ├── FoulBall
│   ├── FoulTip
│   ├── FoulBunt
│   └── BallInPlay → AtBatResult
│
├── AtBatResult (final result for batter)
│   ├── Reaches
│   │   ├── Single
│   │   ├── Double
│   │   ├── Triple
│   │   ├── HomeRun (over-fence)
│   │   ├── InsideTheParkHR
│   │   ├── GroundRuleDouble
│   │   ├── Walk (BB)
│   │   ├── IntentionalWalk (IBB)
│   │   ├── HitByPitch (HBP)
│   │   ├── ReachedOnError (E#, fielder position)
│   │   ├── FieldersChoice (FC, batter reaches, runner put out)
│   │   ├── CatchersInterference (CI)
│   │   └── DroppedThirdStrike (K+WP or K+PB)
│   │
│   └── Out
│       ├── StrikeoutSwinging (K)
│       ├── StrikeoutLooking (Kc)
│       ├── Groundout (fielding sequence, no prefix)
│       ├── Flyout (F prefix)
│       ├── LineOut (L prefix)
│       ├── PopOut (P prefix)
│       ├── BuntOut (B prefix)
│       ├── SacrificeBunt (SH)
│       ├── SacrificeFly (SF)
│       ├── InfieldFly (IFF)
│       └── MultiOutPlay
│           ├── DoublePlay (DP)
│           └── TriplePlay (TP)
│
└── BetweenPitchEvent (baserunner event, no batter action)
    ├── StolenBase (SB2, SB3, SBH)
    ├── CaughtStealing (CS2, CS3, CSH, fielding sequence)
    ├── Pickoff (PKO, fielding sequence)
    ├── WildPitch (WP, runners advance)
    ├── PassedBall (PB, runners advance)
    ├── Balk (BK, all runners advance one)
    ├── DefensiveIndifference (DI)
    ├── RunnerAdvancesOnError (E#)
    ├── RunnerOutAdvancing (OA, fielding sequence)
    ├── Rundown (sequence of fielders)
    ├── Obstruction (OBS)
    └── RunnerInterference (INT)
```

---

## 8. Runner Outcome Encoding

Every at-bat result that puts the ball in play can simultaneously affect multiple runners. Each runner's outcome must be independently encoded:

| Runner Outcome | Code     | Description                                              |
|----------------|----------|----------------------------------------------------------|
| Scores         | `H` (home) | Runner crosses home plate; run scored                  |
| Advances safely | `2`, `3`  | Runner moves to specified base                          |
| Holds          | stays    | Runner stays at current base                            |
| Out            | `out`    | Runner retired; specify fielding sequence if applicable  |
| Out at base    | `out@#`  | Runner thrown out at specific base                      |

When recording a double play or any multi-out play, both the **order** of outs and the **runner involved** in each out must be captured. The fielding sequence provides the order; the runner is identified by their base at the start of the play.

---

## 9. Implications for Data Model

The notation analysis reveals the following requirements for a well-formed play data structure:

1. **Batted ball type** must be a first-class attribute (ground, fly, line, pop, bunt) — it is not derivable from the fielding sequence alone.

2. **Fielding sequences** are ordered lists, not sets. Position 6-4-3 is meaningfully different from 6-3-4 (which would be an error or unusual play).

3. **Pitch-level events** (individual balls and strikes) are separate from **at-bat-level results**. A model that only stores the terminal result cannot reconstruct pitch counts.

4. **Between-pitch events** are independent of at-bat results and require their own event type in the stream.

5. **Runner outcomes** are per-runner and must reference the runner's **starting base** to unambiguously identify who was involved (since a runner on 1B and a runner on 2B are different runners).

6. **Multiple outs** on a single play must preserve order, because the first out may affect whether subsequent plays constitute force outs or tag outs (e.g., if the first out removes the force at second, the second out requires a tag).

7. **Error attribution** is distinct from outcome: a runner may advance due to an error without the batter being awarded a hit; the out/safe result and the error are separate facts.
