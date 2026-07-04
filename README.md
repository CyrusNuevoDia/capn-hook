# Don’t grep the same mystery twice.

Agent-discovered, human-readable Q&A route cache, backed by exact file hashes, chart/unchart only, auto-invalidated before use.

**Code graphs know the code. Capn remembers the path the agent already paid to discover.**

## The problem

Coding agents re-explore the same codebase every session. The route from "where are payment webhooks handled?" to "`src/api/webhooks.ts`, handlers in `src/billing/handlers/`" costs real time and tokens — and evaporates when the session ends.

## How it works

1. **Chart** — when the agent spends real effort discovering where something lives, it records the route: a question, the answer (with paths), and the files that back it. Each file is content-hashed (sha256) at charting time.
2. **Ask / reflect** — future sessions get a tiny contract at startup, then run `capn ask` before searching the codebase and `capn reflect` before guessing how the user will react. Capn recalls through QMD: hybrid search when embeddings are on, BM25 when embeddings are off.
3. **Cache-bust** — if any file backing an entry changes or disappears, the entry is uncharted before it can answer. Never updated. The agent re-charts if the question comes up again.

The chart is chart or unchart only. Charting is exploration; uncharting is cache invalidation. There is no update — an entry is either still true (hashes match) or worthless.

## Install

Onboarding a new project? Paste [INSTALL.md](INSTALL.md) into your coding agent and tell it to install capn-hook here — it's written for the agent to execute, not for you to copy by hand.

Requires [bun](https://bun.sh). Once published, install the CLI from npm:

```sh
npm install -g capn-hook
cd /path/to/your/project
capn init            # .capn/, capn's QMD index, Claude Code hooks, and Codex hooks
capn init --git      # also install a post-commit hook that prunes
```

For source checkouts before a release, install dependencies and symlink the entrypoint:

```sh
just install        # or: CAPN_BIN_DIR=/some/path-on-PATH just install
cd /path/to/your/project
capn init            # .capn/, capn's QMD index, Claude Code hooks, and Codex hooks
capn init --git      # also install a post-commit hook that prunes
```

`capn init` wires SessionStart hooks for both Claude Code and Codex; that injected context contract is the only prompt to chart, and the model decides.

| Agent       | File                          | Hook         | Command                                      | Effect                                 |
| ----------- | ----------------------------- | ------------ | -------------------------------------------- | -------------------------------------- |
| Claude Code | `.claude/settings.local.json` | SessionStart | `/usr/bin/env` + args `["capn", "context"]` | Inject the ask-first charting contract |
| Codex       | `.codex/hooks.json`           | SessionStart | `/usr/bin/env` + args `["capn", "context"]` | Inject the ask-first charting contract |

Embedding is on by default. `capn init` prepares capn's own QMD SDK index at `.capn/qmd/index.sqlite`; the first embed model download is about 300MB, and the full hybrid query pipeline may download about 2GB total on first use. A cold `capn ask` with hybrid search can take a few seconds once the models are present. For deterministic or lightweight projects, use `capn init --no-embedding` to use BM25 search only.

Already use qmd yourself? capn's index is its own sqlite under `.capn/` — your collections never see it, and it never sees yours.

## Commands

| Command                                           | Description                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `capn ask "<question>"`                           | Recall relevant charted answers after pruning stale entries first               |
| `capn chart "<question>" "<answer>" --files <a,b>` | Record a route, hashing each backing file                                       |
| `capn unchart <id>`                               | Manually cache-bust one chart entry                                             |
| `capn reflect "<question>"`                       | Recall prediction-journal entries and their rewards                             |
| `capn predict "<prediction>"`                     | Record a prediction about the user's future response                            |
| `capn reward <id> <0..1> "<observation>"`         | Resolve a prediction with a score and observation                               |
| `capn consolidate [--clear]`                      | Write a journal consolidation packet path, or clear the journal after handoff    |
| `capn bust <path>`                                | Delete every chart entry backed by one file                                     |
| `capn prune`                                      | Delete every chart entry whose files changed or vanished                        |
| `capn list`                                       | Print charted entries, human-readable                                           |
| `capn context`                                    | Print the ask-first charting contract (used by the SessionStart hook)           |
| `capn init [--git] [--embedding\|--no-embedding]` | Set up `.capn/`, capn's QMD index, hooks, and gitignore lines                   |

## The chart

`.capn/entries/<id>.md` — one markdown file per question, committed to the repo. Entries are plain text you can open and read; the chart is browsable by humans, not just tools.

```md
---
capn: 1
id: 9f3a1c2e
at: 2026-07-03T18:00:00.000Z
files:
  src/api/webhooks.ts: 2f4c0b9c3e0a0c7b5d5d7f8f0a6e2d1c4b8a6f1e2d3c4b5a6978877665544332
---

# Where are payment webhooks handled?

Router in src/api/webhooks.ts; per-event handlers in src/billing/handlers/.
```

`.capn/map.json` — a derived reverse index from file path to current hash and entry ids. Commit it for fast busting; if it is missing or corrupt, capn rebuilds it from entry frontmatter.

```json
{
  "src/api/webhooks.ts": {
    "hash": "2f4c0b9c3e0a0c7b5d5d7f8f0a6e2d1c4b8a6f1e2d3c4b5a6978877665544332",
    "entries": ["9f3a1c2e"]
  }
}
```

`.capn/config.json` stores project options such as `{"embedding": true}`. `.capn/qmd/index.sqlite` is generated by the QMD SDK, with normal sqlite `-wal`/`-shm` siblings beside it; the markdown under `.capn/entries/` remains the durable source of truth, and `capn init` can rebuild the index.

## The journal

`.capn/journal/<id>.md` — one markdown file per prediction. The journal is indexed separately so `capn ask` never returns predictions; use `capn reflect` for this surface.

Unresolved:

```md
---
capn: 1
id: a7b9c3d1
at: 2026-07-03T18:10:00.000Z
---

# The user will want this split into two commits.
```

Rewarded:

```md
---
capn: 1
id: a7b9c3d1
at: 2026-07-03T18:10:00.000Z
score: 0.8
rewardedAt: 2026-07-03T18:14:00.000Z
---

# The user will want this split into two commits.

They asked for logical commits before pushing.
```

The journal and `.capn/MIND.md` are per-user memory and are gitignored by `capn init`; the managed lines are `.capn/qmd/`, `.capn/journal/`, and `.capn/MIND.md`. Charts are episodic memory about the codebase; the journal plus MIND.md are a theory of mind of the user, updated by prediction error — only surprises teach. Consolidation happens offline: a scheduled agent runs `capn consolidate`, reads the packet tmpfile, rewrites `.capn/MIND.md`, then runs `capn consolidate --clear`. MIND.md is never rewritten in-session.

## Design principles

- **Chart or unchart, never update.** Staleness is decided by content hashes, not judgment calls.
- **Answers are never stale.** `capn ask` removes invalid entries before returning anything.
- **The chart is disposable.** Any entry can be uncharted at any time; the worst case is the agent re-explores, which is exactly the status quo.
- **Agent-agnostic core.** The CLI and chart format know nothing about Claude Code; the hooks are a thin adapter. Other agents integrate by calling the same CLI.
- **Local-first recall.** QMD runs in-process through the SDK against `.capn/qmd/index.sqlite`, isolated from any host qmd install. A future latency path could keep a daemon warm, but the v0.4 contract does not require one.

## Migrating from v0.3

Re-run `capn init`; it rebuilds the index from the markdown. If capn created your project's root `.qmd/`, you can delete it and its `.gitignore` line.

## Testing

```sh
just check               # type/lint gate plus the subprocess-only suite
bun test                 # subprocess-only suite only; hermetic (BM25, no models)
sh tests/agent-e2e.sh    # two-phase agent-in-the-loop E2E (spawns codex twice)
```

The unit suite drives the CLI strictly as a subprocess in temp dirs. The E2E drops two cold agents into [tests/treasure-cove/](tests/treasure-cove/): phase A must learn charting from the injected contract alone; phase B must answer by asking the capn instead of re-exploring.

## Releases

Publishing is owned by GitHub Actions. Pull requests that touch published package inputs need a `.changeset/*.md` file; use an empty changeset for package-adjacent changes that should not bump the version:

```sh
bun changeset
bun changeset --empty
```

When those changes land on `main`, the `release-cli` workflow runs `just check`, applies Changesets, commits any generated version/changelog update back to `main`, publishes `capn-hook` to npm through Trusted Publishing, and tags the published version. Do not publish locally.

## Status

v0.4 is specified by [GOAL.md](GOAL.md), the standing cold-audit verifier. [docs/shaping.md](docs/shaping.md) has the design history. Agent-facing repo conventions live in [AGENTS.md](AGENTS.md).
