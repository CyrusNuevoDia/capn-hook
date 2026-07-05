# 🧢🪝 cap'n hook

*Don't grep the same mystery twice.*

Persistent memory for coding agents. When your agent spends ten minutes figuring out where something lives in your codebase, capn saves the answer. The next session gets it back in one command instead of re-exploring — and the moment the underlying files change, the saved answer deletes itself.

## The problem

Coding agents forget everything between sessions. The route from "where are payment webhooks handled?" to "`src/api/webhooks.ts`, handlers in `src/billing/handlers/`" costs real time and tokens — and evaporates when the session ends. Tomorrow's session pays for the same discovery again.

## How it works

`capn init` installs a session-start hook for Claude Code and Codex. Every new session, the agent sees one short note: **before searching the codebase, ask capn; after a hard-won discovery, save it.** That note (`capn context`) is the entire integration — no wrapper, no middleware, no forced behavior. The model reads it and decides.

From there the loop is three moves:

**1. Ask before searching.**

```sh
capn ask "where are payment webhooks handled?"
```

A hit returns the saved answer and the exact files, skipping the whole search. A miss costs seconds; re-exploring costs minutes.

**2. Save what was expensive to learn.** When the agent works out an answer the hard way, it records the question, the answer, and the files that back it:

```sh
capn chart "where are payment webhooks handled?" \
  "Router in src/api/webhooks.ts; handlers in src/billing/handlers/" \
  --files src/api/webhooks.ts
```

Each backing file is fingerprinted (sha256) at save time.

**3. Stale answers delete themselves.** If any backing file changes or disappears, the entry is removed before it can ever answer again. Saved answers are never edited — an answer is either still true (its files haven't changed) or it's worthless. That's why the commands are `chart` and `unchart`, not `add` and `update`: capn treats your codebase like a coastline. The agent charts what it has explored; when the coastline shifts, the old chart gets thrown out and the agent re-charts on the next encounter.

Worst case, an entry is deleted and the agent re-explores — which is exactly what it would have done without capn.

## Install

```sh
npm install -g capn-hook
# or
bun install -g capn-hook

cd /path/to/your/project
capn init            # .capn/, capn's QMD index, Claude Code hooks, and Codex hooks
capn init --git      # also install a post-commit hook that prunes
```

The published CLI ships as JavaScript and runs under Bun when Bun is available, falling back to Node.js. Set `CAPN_RUNTIME=node` or `CAPN_RUNTIME=bun` to force one runtime.

Prefer to delegate? Tell your coding agent to fetch and follow [INSTALL.md](https://github.com/CyrusNuevoDia/capn-hook/blob/main/INSTALL.md) — it's written for the agent to execute, not for you to copy by hand.

| Agent       | File                          | Hook         | Command                                     | Effect                                 |
| ----------- | ----------------------------- | ------------ | ------------------------------------------- | -------------------------------------- |
| Claude Code | `.claude/settings.local.json` | SessionStart | `/usr/bin/env` + args `["capn", "context"]` | Inject the ask-first charting contract |
| Codex       | `.codex/hooks.json`           | SessionStart | `/usr/bin/env` + args `["capn", "context"]` | Inject the ask-first charting contract |

Recall runs on [QMD](https://github.com/tobi/qmd): semantic (hybrid) search by default, plain keyword (BM25) search with `capn init --no-embedding`. The default path downloads embedding models on first use (about 300MB up front, up to ~2GB for the full hybrid pipeline) and a cold `capn ask` can take a few seconds once they're present; the BM25 path downloads nothing and is fully deterministic.

Already use qmd yourself? capn's index is its own sqlite under `.capn/` — your collections never see it, and it never sees yours.

## Commands

| Command                                            | Description                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `capn init [--git] [--embedding\|--no-embedding]`  | Set up `.capn/`, capn's QMD index, hooks, and the `.capn/` gitignore line     |
| `capn context`                                     | Print the ask-first charting contract (used by the SessionStart hook)         |
| `capn ask "<question>"`                            | Recall relevant charted answers after pruning stale entries first             |
| `capn chart "<question>" "<answer>" --files <a,b>` | Record a discovery, hashing each backing file                                 |
| `capn unchart <id>`                                | Manually delete one chart entry                                               |
| `capn bust <path>`                                 | Delete every chart entry backed by one file                                   |
| `capn prune`                                       | Delete every chart entry whose files changed or vanished                      |
| `capn list`                                        | Print charted entries, human-readable                                         |

## The chart

`.capn/entries/<id>.md` — one local markdown file per question. Entries are plain text you can open and read; the chart is browsable by humans, not just tools. `capn init` gitignores `.capn/`, so this memory stays local to the working copy.

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

`.capn/map.json` — a derived reverse index from file path to current hash and entry ids. If it is missing or corrupt, capn rebuilds it from entry frontmatter.

```json
{
  "src/api/webhooks.ts": {
    "hash": "2f4c0b9c3e0a0c7b5d5d7f8f0a6e2d1c4b8a6f1e2d3c4b5a6978877665544332",
    "entries": ["9f3a1c2e"]
  }
}
```

`.capn/config.json` stores local project options such as `{"embedding": true}`. `.capn/qmd/index.sqlite` is generated by the QMD SDK, with normal sqlite `-wal`/`-shm` siblings beside it; the markdown under `.capn/entries/` remains the durable source of truth, and `capn init` can rebuild the index.

The whole `.capn/` directory is local agent memory and is gitignored by `capn init`. Chart entries are episodic memory about the codebase: local, disposable, and safe to rebuild by re-exploring.

## Design principles

- **Chart or unchart, never update.** Staleness is decided by content hashes, not judgment calls.
- **Answers are never stale.** `capn ask` removes invalid entries before returning anything.
- **The chart is disposable.** Any entry can be deleted at any time; the worst case is the agent re-explores, which is exactly the status quo.
- **Agent-agnostic core.** The CLI and chart format know nothing about Claude Code; the hooks are a thin adapter. Other agents integrate by calling the same CLI.
- **Local-first recall.** QMD runs in-process through the SDK against `.capn/qmd/index.sqlite`, isolated from any host qmd install. No daemon, no server — nothing to keep running.

## License

MIT
