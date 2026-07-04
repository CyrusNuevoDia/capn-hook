# Capn Hook

Dynamic memory for coding agents. The agent charts discoveries as it explores a codebase — an index of questions and where their answers live — and future sessions ask the capn before re-exploring. When the underlying files change, the affected entries are deleted. A capn charting waters, built on hooks.

## The problem

Coding agents re-explore the same codebase every session. The route from "where are payment webhooks handled?" to "`src/api/webhooks.ts`, handlers in `src/billing/handlers/`" costs real time and tokens — and evaporates when the session ends.

## How it works

1. **Chart** — when the agent spends real effort discovering where something lives, it records the route: a question, the answer (with paths), and the files that back it. Each file is content-hashed (sha256) at charting time.
2. **Ask** — future sessions get a tiny contract at startup, then run `capn ask` before searching. Capn recalls relevant charted answers through QMD: hybrid search when embeddings are on, BM25 when embeddings are off.
3. **Cache-bust** — if any file backing an entry changes or disappears, the entry is deleted before it can answer. Never updated. The agent re-charts if the question comes up again.

The chart is add or delete only. Adding is exploration; deleting is cache invalidation. There is no update — an entry is either still true (hashes match) or worthless.

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

| Hook | Command | Effect |
| --- | --- | --- |
| SessionStart | `capn context` | Inject the ask-first charting contract |
| Stop | `capn nudge` | Once per session, ask the agent to chart discoveries before stopping |

Embedding is on by default. `capn init` runs QMD setup and, when embedding is enabled, `qmd embed`; the first embed model download is about 300MB, and the full hybrid query pipeline may download about 2GB total on first use. A cold `capn ask` with hybrid search can take a few seconds once the models are present. For deterministic or lightweight projects, use `capn init --no-embedding` to use BM25 search only.

## Commands

| Command | Description |
| --- | --- |
| `capn add "<question>" "<answer>" --files <a,b>` | Chart a route. Hashes each file; re-adding a question replaces the old entry (delete + add) |
| `capn ask "<question>"` | Recall relevant charted answers after deleting any stale entries first |
| `capn bust <path>` | Delete every entry backed by one file |
| `capn prune` | Delete every entry whose files changed or vanished |
| `capn list` | Print charted entries, human-readable |
| `capn delete <id>` | Manually cache-bust one entry |
| `capn context` | Print the ask-first charting contract (used by the SessionStart hook) |
| `capn nudge` | Stop-hook handler; blocks once per session with a reminder to chart |
| `capn init [--git] [--embedding\|--no-embedding]` | Set up `.capn/`, `.qmd/`, QMD registration, and hooks in a project |

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

## Design principles

- **Add or delete, never update.** Staleness is decided by content hashes, not judgment calls.
- **Answers are never stale.** `capn ask` deletes invalid entries before returning anything.
- **The chart is disposable.** Any entry can be deleted at any time; the worst case is the agent re-explores, which is exactly the status quo.
- **Agent-agnostic core.** The CLI and chart format know nothing about Claude Code; the hooks are a thin adapter. Other agents integrate by calling the same CLI.
- **Local-first recall.** QMD is project-local. A future latency path could keep `qmd mcp --http --daemon` warm, but the v0.2 contract does not require a daemon.

## Testing

```sh
bun test                 # subprocess-only suite; hermetic (BM25, no models)
sh tests/agent-e2e.sh    # two-phase agent-in-the-loop E2E (spawns codex twice)
```

The unit suite drives the CLI strictly as a subprocess in temp dirs. The E2E drops two cold agents into [tests/treasure-cove/](tests/treasure-cove/): phase A must learn charting from the injected contract alone; phase B must answer by asking the capn instead of re-exploring.

## Status

v0.2 implemented and verified: unit suite green, two-phase agent E2E passing. [GOAL.md](GOAL.md) is the standing cold-audit verifier; [docs/shaping.md](docs/shaping.md) has the design history. Agent-facing repo conventions live in [AGENTS.md](AGENTS.md).
