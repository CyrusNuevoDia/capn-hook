# Use cases

What capn actually does for you, scenario by scenario. The common shape: an agent paid for a discovery once, and capn makes sure no later session pays for it again. (Who this is for: [audience.md](audience.md).)

## The repeat question

The core case, and the one the [eval](../eval/RESULTS.md) measures. Session N spends ten minutes and 200k tokens tracing "where are payment webhooks handled?" through the router, the billing module, and two red herrings — then charts it:

```sh
capn chart "where are payment webhooks handled?" \
  --files src/api/webhooks.ts,src/billing/handlers/stripe.ts \
  --details "Router starts near line 40; Stripe handler owns signature checks."
```

Session N+1 asks the same question and gets the files back in one command. Across 60 real questions on 5 production codebases: 77% fewer tokens, every answer correct, the right chart recalled every time.

## Surviving `/clear` and compaction

Discoveries don't just die at session end — they die mid-session, when a long conversation compacts or you `/clear` to start fresh. Anything charted before the wipe survives it, and the SessionStart hook re-arms the ask-first contract on the cleared session. The chart is the part of the agent's working memory that doesn't live in the context window.

## Coming back after weeks away

You return to a project after a month. The subsystems nobody touched still answer instantly — their files haven't changed, so their charts are still true. The subsystem that got refactored answers nothing: its charts deleted themselves the moment their backing files changed. The agent re-explores exactly the territory that moved, and nothing else.

## One map, two agents

Claude Code and Codex hooked into the same checkout share one `.capn/`. A route Claude Code charted is a route Codex recalls — the chart is plain markdown and the recall is a CLI call, so nothing about it is agent-specific. Switching tools stops meaning starting over.

## Charting gotchas, not just locations

`--files` is the answer; `--details` carries what the files won't tell a fresh reader — the line number where the router starts, the handler that owns signature checks, the config flag that must be set before the test passes. The constraint is that details ride on files: when the files change, the gotcha is presumed dead and the entry goes with them. That's the point — a gotcha that outlives its code is a trap.

## Refactoring without poisoned memory

Memory systems fail by lying: the note says `src/api/webhooks.ts` and the file moved two refactors ago. capn's answer to this isn't better updating — it's no updating. Every entry is content-hashed at chart time, `capn ask` prunes stale entries before returning anything, and `capn init --git` adds a post-commit prune. After a big refactor the chart shrinks instead of drifting; what remains is only what's still true.

## Cold-start agents on a schedule

Review bots, cron agents, CI jobs — every run is session one. Without memory, each run re-buys the same orientation on the same repo. With capn, the first runs chart the territory and later runs recall it; at ~1.6 recalls to break even, anything that runs daily is profitable by the end of the week. For non-interactive runs where hooks don't fire, put `capn context` output in the prompt — the whole integration is that one block of text.

## What not to chart

capn answers are sets of files, so only chart what a file in the repo can answer:

- **Not live state.** "Why is staging broken" is debugging, not location — the answer isn't a file, and tomorrow it isn't even true.
- **Not external services.** The Stripe dashboard's webhook settings live outside the repo; no content hash can defend that answer.
- **Not preferences or conventions.** "We use tabs" belongs in AGENTS.md, loaded every session — not recalled on demand.

The test is simple: if the answer is "these files," chart it. Anything else, the chart can't keep honest.
