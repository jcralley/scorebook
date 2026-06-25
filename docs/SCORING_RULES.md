# Scoring & Baserunning Rules

This is the reference for how Scorebook resolves baserunning. The behavior is
implemented in `recomputeInning` (force resolution) and `planRunnerQuestions`
(which runners require a manual decision) in `src/index.html`.

## Principle

Every at-bat stores the scorer's **intent**; the engine **derives** where each
runner ends up. Whenever any play changes, the whole inning is replayed in batting
order, so corrections cascade correctly.

## What is a force?

A runner is forced to advance **only when the runner immediately behind them
(ultimately the batter) needs their base.** The force is an unbroken chain of
occupied bases back to the batter, and it **breaks at the first empty base.**

So with runners on 2nd and 3rd but 1st base empty, **neither runner is forced** by
the batter reaching base — there is a gap behind them.

## Forces resolve base by base

The batter advances one base at a time, from 1st up to the base their hit earns.
Each time the batter **enters an occupied base**, that runner is forced ahead one
base; if the next base is also occupied, the push **cascades** forward (and a runner
pushed past home scores).

### Example: runners on 2nd & 3rd, batter doubles
| Step | Batter enters | Effect |
|------|---------------|--------|
| 1 | 1st | empty — no force |
| 2 | 2nd | occupied — runner 2nd→3rd, which forces runner 3rd→home (scores) |

**Result:** runner from 3rd scores, runner from 2nd to 3rd, batter on 2nd. A normal
one-run double.

### Same runners, batter singles
The batter only reaches 1st and never enters 2nd or 3rd, so **no one is forced.**
The runners hold unless you advance them manually (see prompts below). On a real
single they'd often advance — but that's a judgment call, not a force.

## Auto-resolved vs. prompted

| Situation | Handling |
|-----------|----------|
| Forced runners | Advanced automatically, silently |
| Home run | All runners + batter score automatically |
| Unforced runner who might advance/score/be thrown out | **Prompted** |
| Extra out(s) on a double/triple play | **Prompted** |

When a prompt is needed, the app asks about each ambiguous runner **lead-first**
(3rd → 2nd → 1st) so a lead runner's outcome frees bases for trailing runners. Each
question offers only legal outcomes — **Out / Hold / To `<base>` / Score** — with a
**likely default pre-selected** for one-tap confirmation.

## Outs and half-innings

Each recorded out — a retired batter, plus any runner outs from the `adv` map (force
outs, a runner thrown out on the play, the extra out(s) on a DP/TP) — is tallied for
the half-inning. The scoreboard shows the live count as filled dots. When the active
half-inning reaches **3 outs**, the scorecard automatically advances to the next
half-inning and flips the visible grid to the team now coming up to bat. Editing a
past or inactive half-inning never triggers a flip; the inning pill remains available
as a manual override.

## Double and triple plays

Choose `DP` (or `TP`). The batter is out. The prompt then defaults the **trail**
runner(s) nearest the batter to **Out** (the force out) and lead runners to advancing
one base.

### Example: men on 1st & 2nd, 6-4-3 double play
The prompt appears as:

- **Runner on 2nd** — Out / To 3rd / Score → default **To 3rd**
- **Runner on 1st** — Out / To 2nd / To 3rd / Score → default **Out**

Confirming the defaults records the textbook double play: batter out, runner from 1st
out at 2nd, runner from 2nd advances to 3rd. Adjust either if the play went otherwise
(e.g. a run scored, or the lead runner was retired instead).

A `TP` requires two extra outs beyond the batter; the prompt tracks how many outs
you've marked against how many the play needs.

## Result codes

| Code | Meaning | Batter reaches |
|------|---------|----------------|
| `1B` `2B` `3B` `HR` | Single / Double / Triple / Home run | 1 / 2 / 3 / 4 |
| `BB` `HBP` | Walk / Hit by pitch | 1 |
| `E` | Reached on error | 1 |
| `FC` | Fielder's choice | reaches, but a runner is typically out |
| `K` `ꓘ` | Strikeout (swinging / looking) | out |
| `GO` `FO` `LO` `PO` | Ground / Fly / Line / Pop out | out |
| `SF` `SAC` | Sac fly / Sac bunt | out (may advance/score a runner) |
| `DP` `TP` | Double / Triple play | out (+ runner outs) |

## RBI handling

RBI are credited automatically for runners driven in by a hit or forced home (and for
the batter on a home run). The at-bat modal also exposes a manual RBI control for
cases the engine can't infer. Runs scored on a double/triple play are recorded without
an RBI.

## Edge cases handled

- **Gap breaks the force:** men on 2nd & 3rd, 1st empty → no forced advance on any
  hit; runners prompted instead.
- **Cascading force:** bases loaded + walk forces in exactly one run; everyone else
  advances one base.
- **Multi-base force:** man on 1st + double → forced to 3rd alongside the batter.
- **Grand slam:** bases loaded + HR → four runs, four RBI.
- **Unforced runner blocking the batter:** man on 2nd (unforced) + batter doubles →
  the batter cannot pass the runner; resolved via the prompt.
