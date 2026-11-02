# Use cases

What capn does for you, scenario by scenario. An agent charts a discovery once, and later sessions can recall it while the backing files match. (Who this is for: [audience.md](audience.md).)

## The repeat question

The core case, and the one the [eval](../eval/RESULTS.md) measures. Session N spends ten minutes and 200k tokens tracing "where are payment webhooks handled?" through the router, the billing module, and two red herrings — then charts it:

```sh
capn chart "where are payment webhooks handled?" \
  --files src/api/webhooks.ts,src/billing/handlers/stripe.ts \
  --details "Router starts near line 40; Stripe handler owns signature checks."
```

Session N+1 asks the same question and gets the files back in one command. Historical runs across 60 questions on five production codebases measured 77% fewer tokens, with the relevant chart returned for all 60 questions. The filename scorer didn't establish complete answer coverage or semantic correctness; see the [eval limitations](../eval/RESULTS.md#what-this-does-and-doesnt-show).

## Surviving `/clear` and compaction

Discoveries don't just die at session end — they die mid-session, when a long conversation compacts or you `/clear` to start fresh. Anything charted before the wipe survives it, and the SessionStart hook re-arms the ask-first contract on the cleared session. The chart is the part of the agent's working memory that doesn't live in the context window.

## Coming back after weeks away

You return to a project after a month. Discoveries backed by unchanged files remain eligible for recall. A refactor hides versions whose backing files changed, so the agent re-explores that code and charts another immutable version. Earlier versions remain available to matching checkouts or after a revert.

## One map, two agents

Claude Code and Codex hooked into the same checkout share its central workspace under `~/.capn/`. A route Claude Code charted is a route Codex can recall — the chart is plain Markdown and recall is a CLI call, so nothing about it is agent-specific.

## Following a flow across repositories

An event publisher and its consumer live in separate repositories, and each has its own agent session. Register both in the same [workspace](../README.md#related-repositories-and-worktrees), then chart a focused question with backing files from both repositories. A session in either repository can recall the result as absolute file paths without loading every discovery into its prompt.

Each command selects the invoking checkout for its repository and the designated default checkout for each companion. Git worktrees reuse the workspace, but branch names don't pair companion checkouts. A discovery appears only when every backing file matches that selection.

## Charting gotchas, not just locations

`--files` is the answer; `--details` carries what the files won't tell a fresh reader — the line number where the router starts, the handler that owns signature checks, the config flag that must be set before the test passes. Details apply only while all backing files match, so a file change hides the version and its gotchas together.

## Refactoring without poisoned memory

An old note might point to `src/api/webhooks.ts` after the file has moved. Capn hashes complete backing files at chart time and filters out mismatched versions before searching. Chart changed evidence as another immutable version, or use `unchart` to forget an exact version across the workspace. `capn init --git` adds a post-commit prune that reconciles the checkout view and cleans confirmed dead bindings and unused indexes while retaining discoveries.

## Cold-start agents on a schedule

Review bots, cron agents, CI jobs — every run starts with a fresh context. With persistent central storage, early runs chart discoveries and later runs can recall them. The historical eval measured break-even at ~1.6 recalls of the same question; it didn't measure changing daily workloads. For non-interactive runs where hooks don't fire, put `capn context` output in the prompt.

## What not to chart

capn answers are sets of files, so only chart what files in the workspace's repositories can answer:

- **Not live state.** "Why is staging broken" is debugging, not location — the answer isn't a file, and tomorrow it isn't even true.
- **Not external services.** The Stripe dashboard's webhook settings live outside the repo; no content hash can defend that answer.
- **Not preferences or conventions.** "We use tabs" belongs in AGENTS.md, loaded every session — not recalled on demand.

The test is simple: if the answer is "these files," chart it. Anything else, the chart can't keep honest.
