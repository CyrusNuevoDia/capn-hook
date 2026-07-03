# Captain Hook

Dynamic memory for coding agents. The agent charts discoveries as it explores a codebase — an index of questions and where their answers live — and the map is injected into every future session. When the underlying files change, the affected entries are deleted. A captain charting waters, built on hooks.

## The problem

Coding agents re-explore the same codebase every session. The route from "where are payment webhooks handled?" to "`src/api/webhooks.ts`, handlers in `src/billing/handlers/`" costs real time and tokens — and evaporates when the session ends.

## How it works

1. **Chart** — when the agent spends real effort discovering where something lives, it records the route: a question, the answer (with paths), and the files that back it. Each file is content-hashed (sha256) at charting time.
2. **Recall** — at session start, a hook prunes stale entries and prints the whole map into the agent's context, along with the charting contract.
3. **Cache-bust** — if any file backing an entry changes or disappears, the entry is deleted. Never updated. The agent re-charts if the question comes up again.

The map is add or delete only. Adding is exploration; deleting is cache invalidation. There is no update — an entry is either still true (hashes match) or worthless.

## Install

```sh
bun link                # from this repo: puts `captain` on your PATH
cd /path/to/your/project
captain init            # .captain/ + Claude Code hooks in .claude/settings.json
captain init --git      # also install a post-commit hook that prunes
```

`captain init` wires up two Claude Code hooks:

| Hook | Command | Effect |
| --- | --- | --- |
| SessionStart | `captain context` | Prune, then inject the map + charting contract into context |
| Stop | `captain nudge` | Once per session, ask the agent to chart discoveries before stopping |

## Commands

| Command | Description |
| --- | --- |
| `captain add "<question>" "<answer>" --files <a,b>` | Chart a route. Hashes each file; re-adding a question replaces the old entry (delete + add) |
| `captain prune` | Delete every entry whose files changed or vanished |
| `captain list` | Print the map, human-readable |
| `captain delete <id>` | Manually cache-bust one entry |
| `captain context` | Prune + print map and charting contract (used by the SessionStart hook) |
| `captain nudge` | Stop-hook handler; blocks once per session with a reminder to chart |
| `captain init [--git]` | Set up `.captain/` and hooks in a project |

## The map

`.captain/map.jsonl` — one entry per line, paths relative to the project root, so the map is portable and merge-friendly. Commit it and the whole team's agents share one chart.

```json
{"id":"9f3a1c2e","q":"Where are payment webhooks handled?","a":"Router in src/api/webhooks.ts; per-event handlers in src/billing/handlers/","files":[{"path":"src/api/webhooks.ts","hash":"..."}],"at":"2026-07-03T18:00:00Z"}
```

## Design principles

- **Add or delete, never update.** Staleness is decided by content hashes, not judgment calls.
- **The map is disposable.** Any entry can be deleted at any time; the worst case is the agent re-explores, which is exactly the status quo.
- **Agent-agnostic core.** The CLI and map format know nothing about Claude Code; the hooks are a thin adapter. Other agents integrate by calling the same CLI.

## Status

Shaped and specified; implementation is test-driven against [GOAL.md](GOAL.md). See [docs/shaping.md](docs/shaping.md) for the design history.
