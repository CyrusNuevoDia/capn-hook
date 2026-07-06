# capn-hook eval corpus

This directory is for repeatable capn-hook evaluation work against real open
source applications.

## Layout

- `repos.lock.json` records the intended external repositories and pinned HEAD
  commits for this checkout.
- `repos/` contains local clones of those repositories. It is gitignored because
  the clones are large, disposable inputs.
- `cases/` is where tracked eval cases can live once the corpus shape settles.
- `runs/<slug>/` contains committed evidence for completed eval runs.
- `runs/work/` and `runs/.capnbin/` are local scratch artifacts and stay
  untracked.

## First corpus

The initial corpus favors production applications over frameworks:

- Polar: `git@github.com:polarsource/polar.git`
- PostHog: `git@github.com:PostHog/posthog.git`
- Twenty: `git@github.com:twentyhq/twenty.git`
- Dub: `git@github.com:dubinc/dub.git`
- Documenso: `git@github.com:documenso/documenso.git`

Use full clones rather than shallow clones so future eval cases can inspect
history, moved files, and older context when useful. The repos are still local
inputs, not vendored project code.

## Refreshing

To refresh a repo later, update the checkout under `repos/<slug>`, then update
the matching `commit` in `repos.lock.json` with:

```sh
git -C eval/repos/<slug> rev-parse HEAD
```

Do not commit anything under `eval/repos/`. Evidence under
`eval/runs/<slug>/` is committed; only `eval/runs/work/` worktrees and the
`eval/runs/.capnbin/` bin shim stay untracked.

## Running the harness

Run token-cost evals with:

```sh
bun eval/run.ts --repo <slug> [--case <id>] [--phase baseline|a|b|all] [--concurrency <n>] [--teardown]
```

Flags:

- `--repo <slug>` selects a repo from `repos.lock.json` and uses the matching
  pinned commit.
- `--case <id>` restricts the run to one case from `cases/<slug>.json`.
- `--phase baseline|a|b|all` chooses which condition to run. The default is
  `all`.
- `--concurrency <n>` sets how many baseline or recall cases run at once. The
  default is `1` (strictly sequential within a repo — the intended mode; the only
  parallelism we use is cross-repo, one manager per repo). The flag exists for
  ad-hoc use but is normally left at the default.
- `--teardown` removes the baseline and capn worktrees for that repo, then
  exits.

The three measured conditions are:

- `baseline`: a `codex exec` agent answers in a clean worktree with no capn on
  `PATH` and no session-context block.
- `a` / `chart`: a capn-enabled agent answers the same question and is expected
  to explore and chart. This arm is recorded but treated as the setup pass.
- `b` / `recall`: a fresh capn-enabled agent answers the identical question
  after phase `a`; this is the measured with-capn arm.

For `--phase all`, the harness runs all baselines first, then every phase `a`
case, then every phase `b` case. At the default `--concurrency 1` every phase is
sequential; a higher `--concurrency` would run baseline and recall cases that
many at a time. Phase `a` is always sequential regardless, because those cases
write entries into the shared capn-worktree sqlite. Phase `b` intentionally
reuses charts written by phase `a`, including charts from prior invocations, so
normal runs never tear worktrees down implicitly.

The harness injects capn context exactly once for capn-enabled phases: it runs
`capn context` once per invocation and places that text in the prompt's
`<session-context>` block. Empirically, `codex exec` 0.142.5 does not fire
`.codex/hooks.json` `SessionStart` hooks, and the harness deletes that hook file
after `capn init` for deterministic single-injection behavior if future Codex
versions change.

The eval worktrees live under `eval/runs/work/`, which is inside the capn-hook
repo — and capn-hook keeps its own `.capn/` at the repo root. capn resolves its
project root by walking up for the nearest ancestor `.capn/`, so a fresh worktree
would otherwise resolve to capn-hook's own store and both read its entries and
write eval charts into it. The harness prevents this by pre-creating an empty
`.capn/` in the capn worktree before `capn init`, which pins resolution to the
worktree. The baseline worktree never gets a `.capn/` and has no `capn` on
`PATH`, so it stays capn-free.

Outputs are written under `eval/runs/<slug>/`:

- `results.jsonl` gets one JSON result row per attempted run, including token
  usage, wall time, grading, chart-hit diagnostics, and the Codex session ID.
  Concurrent appends are serialized so every row is written as a complete JSONL
  line.
- `answers/<caseId>-<condition>.txt` stores the agent's final answer from
  `--output-last-message`.
- `prompts/<caseId>-<condition>.txt` stores the verbatim prompt passed to
  `codex exec`.
- `logs/<caseId>-<condition>.jsonl.gz` stores gzipped raw `codex exec --json`
  stdout for debugging.
- `provenance.json` records the repo pin, harness revision, Codex version,
  model, reasoning effort, capn version, embedding mode, concurrency, phase, and
  timestamps.

## Inspecting the data

Committed evidence lives under `eval/runs/<slug>/`:

- `results.jsonl` has one JSON row per run with `caseId`, `condition`,
  `tokens{...}`, `wallMs`, `answerFile`, `correct`, `ambiguous`, `chartHit`,
  `chartHitTopRank`, `chartHitAnyRank`, `flag`, `sessionId`, and `at`.
- `answers/<caseId>-<condition>.txt` is the agent's final answer.
- `prompts/<caseId>-<condition>.txt` is the verbatim prompt sent to Codex. The
  baseline prompt is only the task. The chart and recall prompts are the
  `<session-context>` capn-context block plus the task.
- `logs/<caseId>-<condition>.jsonl.gz` is the gzipped raw
  `codex exec --json` transcript.
- `provenance.json` captures the repo, commit, harness revision, Codex version,
  model, reasoning effort, capn version, embedding mode, and timestamps.

The arms differ deliberately: `baseline` runs with no capn on `PATH` and no
session-context block, while `chart` and `recall` run with capn on `PATH` and an
injected `capn context` block.

Re-run a single case with:

```sh
bun eval/run.ts --repo <slug> --case <id> --phase baseline|a|b
```

Honesty notes: capn context is injected exactly once through the prompt.
`codex exec` does not fire `.codex/hooks.json` hooks, and the harness deletes the
hook file after init. Worktrees pre-create `.capn/` so capn resolves to the
worktree store, not the capn-hook repo's own store. Dub's prompts and provenance
were backfilled because its run predates these artifacts; that is faithful
because `capn context` is static and the prompts were rebuilt with the same
builder. Dub's `chartHit` was re-derived from saved logs after a JSONL-parsing
bug in the detector. All Codex runs use model `gpt-5.5` at
`reasoning_effort=low`.

For recall rows, `chartHitTopRank` is precision@1: the correct chart is the
single top-ranked hit from the first `capn ask`. `chartHitAnyRank` is recall@k:
the correct chart appears anywhere in the returned `capn ask` hits across the
run. `chartHit` is aliased to `chartHitAnyRank` because the recall agent reads
all returned hits. Charts report recall@k; precision@1 is a footnoted
diagnostic. We record both so an auditor can see the metric was not quietly
redefined.

Ranking finding: on some queries a specific chart, an ingestion `person-merge`
entry in PostHog, scores anomalously high and outranks the correct chart, so the
right entry lands at rank 2-4; the agent still recalls it from the returned
list. This is a qmd/capn ranking-precision issue logged for the capn backlog,
not an eval-integrity problem. Across the 5-repo run, precision@1 was 56/60
while recall@k was 60/60.
