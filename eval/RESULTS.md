# Eval: what does capn actually save?

**TL;DR: across 60 real developer questions on 5 production open-source codebases, an agent recalling from capn used 77% fewer tokens than an agent exploring cold — with every answer correct in both arms, and the relevant chart recalled on all 60 questions.**

| | |
| --- | --- |
| Repos | Dub, Polar, PostHog, Twenty, Documenso (pinned commits) |
| Questions | 60 (12 per repo), curated against ground-truth files |
| Runs | 180 (baseline / chart / recall × 60) |
| Agent | `codex exec`, GPT-5.5, `reasoning_effort=low` |
| Token savings (recall vs baseline) | **77.5%** weighted, 76.7% unweighted across repos |
| Answer correctness | 60/60 baseline, 60/60 recall |
| Chart recall | 60/60 (right chart returned by `capn ask`) |
| Break-even | a charting session pays for itself in ~1.6 recalls |

## What was measured

capn's claim is narrow: **don't pay for the same discovery twice.** So the eval measures exactly that — the cost of answering a codebase question an earlier session already answered, with and without capn.

Each of the 60 questions is a real "where does X live / how does Y flow" developer question, like:

> When a short link resolves, where is the final destination URL chosen across bot proxying, custom URI schemes, iOS/Android targeting, and geo targeting?

Every question was curated with ground-truth files — the source files that actually answer it — verified by hand at a pinned commit.

## The three arms

Each question runs three times, always in a clean git worktree at the pinned commit:

1. **Baseline** — the agent answers with no capn installed and no capn context. It explores cold: this is what every fresh session costs today.
2. **Chart** — a capn-enabled agent answers the same question. It explores, then charts its discovery (`capn chart`). This is the setup pass, and it's *more* expensive than baseline — charting isn't free.
3. **Recall** — a fresh agent, new session, same question. capn is installed and the charts from arm 2 exist. This is the measured with-capn arm.

The comparison is **baseline vs recall**: session N+1 exploring cold versus session N+1 recalling what session N learned. The prompt is identical except that capn-enabled arms get the standard `capn context` block a session-start hook would inject — once, verbatim, nothing else.

## Results

Mean total tokens per question:

| Repo | Baseline | Recall | Savings | Break-even |
| --- | ---: | ---: | ---: | ---: |
| Dub | 203,475 | 48,190 | **76.3%** | 1.4 recalls |
| Polar | 188,577 | 56,139 | **70.2%** | 1.8 recalls |
| PostHog | 347,466 | 70,080 | **79.8%** | 1.7 recalls |
| Twenty | 280,783 | 50,435 | **82.0%** | 1.3 recalls |
| Documenso | 191,319 | 47,813 | **75.0%** | 1.5 recalls |
| **All** | | | **77.5%** | **1.6 recalls** |

Savings weren't purchased with wrong answers: **all 180 runs produced a correct answer** (the agent's answer names the ground-truth files). The recall agent isn't skipping the question — it's skipping the search.

**Break-even** counts the charting overhead honestly: the chart arm costs more than baseline (the agent explores *and* writes charts). Dividing that full setup cost by the per-recall savings, a chart pays for itself in ~1.6 recalls of the same territory — everything after that is profit.

**Chart recall was 60/60**: on every question, `capn ask` returned the relevant chart (recall@k, since the agent reads all returned hits). As a stricter diagnostic, the right chart was the *top-ranked* hit on 56/60 (precision@1); in the other four, a different chart outranked it and the agent still recalled the right one from the list.

## What this does and doesn't show

Read the result for what it is:

- **It measures repeat discovery, not transfer.** The recall arm asks the *identical* question that was charted. That's the scenario capn is built for — sessions re-paying for the same discovery — and this eval measures that ceiling deliberately. It does not measure how well charts generalize to related-but-different questions.
- **Grading is mechanical, not judged.** An answer counts as correct when it cites ground-truth file paths (full path or `dir/basename`). No LLM judge, no vibes — but also no credit for partially-right prose, and no penalty for extra wrong files alongside a right one.
- **One agent, one model.** All runs used Codex (`codex exec`) with GPT-5.5 at low reasoning effort. Different agents and models will land on different absolute numbers.
- **Questions were curated by the authors.** They're real subsystem questions (auth, billing, webhooks, sync, search — mostly rated hard), but they're questions we chose.

Design details that keep the comparison fair: the baseline worktree has no `capn` on PATH and no capn context; capn context is injected exactly once per capn-enabled run; and every run's raw evidence — verbatim prompts, final answers, gzipped agent transcripts, and a provenance record (repo pin, harness revision, Codex and capn versions) — is committed under [`runs/`](runs/) for audit.

## Reproduce it

The harness, corpus layout, and per-flag documentation live in [`README.md`](README.md). The short version:

```sh
bun eval/run.ts --repo dub            # run all three arms for one repo
bun eval/summarize.ts                 # regenerate runs/summary.json
```

Cases are in [`cases/`](cases/), pinned commits in [`repos.lock.json`](repos.lock.json), aggregated numbers in [`runs/summary.json`](runs/summary.json). Runs cost real LLM spend.
