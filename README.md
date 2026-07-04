# Don’t grep the same mystery twice.

Agent-discovered, human-readable Q&A route cache, backed by exact file hashes, chart/unchart only, auto-invalidated before use, with hooks that nudge the agent to chart only things it actually had to discover.

**Code graphs know the code. Capn remembers the path the agent already paid to discover.**

## The problem

Coding agents re-explore the same codebase every session. The route from "where are payment webhooks handled?" to "`src/api/webhooks.ts`, handlers in `src/billing/handlers/`" costs real time and tokens — and evaporates when the session ends.

## How it works

1. **Chart** — when the agent spends real effort discovering where something lives, it records the route: a question, the answer (with paths), and the files that back it. Each file is content-hashed (sha256) at charting time.
2. **Ask / reflect** — future sessions get a tiny contract at startup, then run `capn ask` before searching the codebase and `capn reflect` before guessing how the user will react. Capn recalls through QMD: hybrid search when embeddings are on, BM25 when embeddings are off.
3. **Cache-bust** — if any file backing an entry changes or disappears, the entry is uncharted before it can answer. Never updated. The agent re-charts if the question comes up again.

The chart is chart or unchart only. Charting is exploration; uncharting is cache invalidation. There is no update — an entry is either still true (hashes match) or worthless.

## Install

Requires [bun](https://bun.sh). This repo depends on `@tobilu/qmd`; install dependencies before linking the CLI:

```sh
bun install
ln -s "$PWD/src/capn.ts" ~/.local/bin/capn   # or any dir on your PATH
cd /path/to/your/project
capn init            # .capn/, .qmd/, and Claude Code hooks
capn init --git      # also install a post-commit hook that prunes
```

`capn init` wires up two Claude Code hooks:

| Hook         | Command        | Effect                                                               |
| ------------ | -------------- | -------------------------------------------------------------------- |
| SessionStart | `capn context` | Inject the ask-first charting contract                               |
| Stop         | `capn nudge`   | Once per session, ask the agent to chart discoveries before stopping |

Embedding is on by default. `capn init` runs QMD setup and, when embedding is enabled, `qmd embed`; the first embed model download is about 300MB, and the full hybrid query pipeline may download about 2GB total on first use. A cold `capn ask` with hybrid search can take a few seconds once the models are present. For deterministic or lightweight projects, use `capn init --no-embedding` to use BM25 search only.

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
| `capn nudge`                                      | Stop-hook handler; blocks once per session with a reminder to chart             |
| `capn init [--git] [--embedding\|--no-embedding]` | Set up `.capn/`, `.qmd/`, QMD registration, hooks, and gitignore lines          |

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

`.capn/config.json` stores project options such as `{"embedding": true}`. `.qmd/` is generated, project-local, and gitignored; QMD stores its `index.yml` and `index.sqlite` there and indexes the `capn` collection from `.capn/entries/`.

## The journal

`.capn/journal/<id>.md` — one markdown file per prediction. The journal is a second QMD collection named `journal`, excluded from default scope so `capn ask` never returns predictions; use `capn reflect` for this surface.

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

The journal and `.capn/MIND.md` are per-user memory and are gitignored by `capn init`. Charts are episodic memory about the codebase; the journal plus MIND.md are a theory of mind of the user, updated by prediction error — only surprises teach. Consolidation happens offline: a scheduled agent runs `capn consolidate`, reads the packet tmpfile, rewrites `.capn/MIND.md`, then runs `capn consolidate --clear`. MIND.md is never rewritten in-session.

## Design principles

- **Chart or unchart, never update.** Staleness is decided by content hashes, not judgment calls.
- **Answers are never stale.** `capn ask` removes invalid entries before returning anything.
- **The chart is disposable.** Any entry can be uncharted at any time; the worst case is the agent re-explores, which is exactly the status quo.
- **Agent-agnostic core.** The CLI and chart format know nothing about Claude Code; the hooks are a thin adapter. Other agents integrate by calling the same CLI.
- **Local-first recall.** QMD is project-local. A future latency path could keep `qmd mcp --http --daemon` warm, but the v0.3 contract does not require a daemon.

## Testing

```sh
bun test                 # subprocess-only suite; hermetic (BM25, no models)
sh tests/agent-e2e.sh    # two-phase agent-in-the-loop E2E (spawns codex twice)
```

The unit suite drives the CLI strictly as a subprocess in temp dirs. The E2E drops two cold agents into [tests/treasure-cove/](tests/treasure-cove/): phase A must learn charting from the injected contract alone; phase B must answer by asking the capn instead of re-exploring.

## Status

v0.3 is specified by [GOAL.md](GOAL.md), the standing cold-audit verifier. [docs/shaping.md](docs/shaping.md) has the design history. Agent-facing repo conventions live in [AGENTS.md](AGENTS.md).
