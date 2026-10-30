# 🧢🪝 cap'n hook

*Don't grep the same mystery twice.*

Persistent memory for coding agents. When your agent spends ten minutes figuring out where something lives, capn saves the files that answer the question. Later sessions recall that discovery in one command, including across related repositories and Git worktrees. An answer appears only when every backing file still matches its saved content.

## 77% fewer tokens on repeat questions

Historical runs across 60 developer questions on five production codebases measured **77% fewer tokens** for recall than cold exploration, with the relevant chart returned for all 60 questions. Those runs used a permissive filename scorer, so they don't establish complete answer coverage or semantic correctness; the stricter scorer hasn't been applied to that evidence.

[How the eval was run, full numbers, and raw evidence →](eval/RESULTS.md) · [Who capn is for →](docs/audience.md) · [Use cases →](docs/use-cases.md)

## How it works

`capn init` installs a session-start hook for Claude Code and Codex. Every session, the agent sees a short note: **before searching the codebase, ask capn; after a discovery that took substantial exploration, chart it.** The note (`capn context`) is the integration; the agent decides when to call the CLI.

**1. Ask before searching.**

```sh
capn ask "where are payment webhooks handled?"
```

A hit returns ranked JSONL with absolute paths to the files that answer the question and the workspace name. A miss exits 1 with a hint on stderr to explore and chart the result.

**2. Save what was expensive to learn.**

```sh
capn chart "where are payment webhooks handled?" \
  --files src/api/webhooks.ts,src/billing/handlers/stripe.ts \
  --details "Router starts near line 40; Stripe handler owns signature checks."
```

The files are the answer; optional details add line numbers or constraints. Split separable discoveries into separate questions, and cite several files when they jointly answer one question. Capn hashes each complete backing file when you chart it.

**3. Recall the version that matches your checkout.**

If a backing file changes or disappears, capn hides that discovery from the checkout's results. The record stays available: reverting the file restores the answer, and another worktree with matching content can still recall it. Charting changed evidence creates an immutable version; charting identical evidence and details reuses the same version. When several versions of the same exact question apply, the newest wins, with the version ID breaking timestamp ties.

## Install

```sh
npm install -g capn-hook
# or
bun install -g capn-hook

cd /path/to/your/project
capn init
capn init --git      # also install a post-commit hook that runs capn prune
```

The published CLI runs under Bun when available, falling back to Node.js. To delegate installation, give your coding agent [INSTALL.md](https://github.com/CyrusNuevoDia/capn-hook/blob/main/INSTALL.md).

Memory lives under `~/.capn/`; agent hooks stay in the checkout:

| Agent | File | Hook | Command |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | SessionStart | `/usr/bin/env capn context` |
| Codex | `.codex/hooks.json` | SessionStart | `/usr/bin/env capn context` |

Recall uses [QMD](https://github.com/tobi/qmd) hybrid search by default. `capn init --no-embedding` selects keyword (BM25) search with no model download. Hybrid search downloads models on first use and shares the model cache across workspaces; separate index generations have separate embeddings. Passing an embedding flag changes the workspace policy; omitting both flags preserves an existing policy.

Capn's QMD databases are isolated from your own QMD collections and project `.qmd/` directory. Existing project-local `.capn/` directories aren't read, changed, or imported.

## Related repositories and worktrees

Repositories can live anywhere on disk. Register each one with the same workspace name and its own alias:

```sh
cd /Volumes/Code/shop-web
capn init --workspace shop --repo web --no-embedding
cd /Users/me/Git/shop-api
capn init --workspace shop --repo api
```

From the web checkout, chart a discovery that spans both repositories using ordinary paths:

```sh
capn chart "where does checkout create an order?" \
  --files src/checkout.ts,/Users/me/Git/shop-api/src/orders.ts
```

Each checkout has one workspace owner. Without naming a workspace, `capn init` creates an isolated workspace or reuses the checkout's existing registration. Git worktrees inherit an unambiguous owner through their repository's common Git directory; branch names and remotes don't establish ownership.

For each command, capn uses the invoking checkout for its repository and the initial registered checkout for each companion repository. This makes a web worktree's context explicit: its own web files plus the default API files. Paths outside those selected roots, symlink escapes, and files in unrelated nested Git repositories are rejected. If a companion checkout is unavailable, discoveries depending on it can't answer.

See [Central workspaces](docs/workspaces.md) for storage, version selection, and cleanup details.

## Commands

| Command | Description |
| --- | --- |
| `capn init [--workspace <name>] [--repo <alias>] [--git] [--embedding\|--no-embedding]` | Register the checkout, prepare recall, and install agent hooks |
| `capn context` | Print the ask-first charting instructions |
| `capn ask "<question>"` | Print up to five ranked JSONL hits from the applicable version set |
| `capn chart "<question>" --files <a,b> [--details "<extra context>"]` | Save an immutable discovery backed by full-file hashes |
| `capn unchart <versionId>` | Forget that exact version across the workspace |
| `capn bust <path>` | Forget applicable versions citing that file |
| `capn prune` | Reconcile the checkout view and clean confirmed dead bindings and unused indexes; retain discoveries |
| `capn list` | Print the workspace's full discovery inventory, including hidden versions |

`chart` accepts relative or absolute filesystem paths. `list` includes every version so you can find IDs for `unchart`, even when a version doesn't match your checkout. `chart` also works before `init`: it saves central Markdown and prints an initialization hint; `init` enables recall and hooks. Other commands require an existing workspace registration and never claim an unregistered checkout, so a first unsuccessful ask leaves you free to choose a workspace with `init`.

## Storage and safety

`~/.capn/config.json` owns workspace settings, repository aliases, default checkouts, and checkout bindings. Discovery Markdown lives in `~/.capn/workspaces/<workspace>/entries/<versionId>.md`. References inside records are logical paths such as `web/src/checkout.ts`, so a record doesn't depend on a particular absolute checkout location.

A version ID is the first 16 lowercase hexadecimal characters of a SHA-256 content identity: the exact question, details, and sorted logical file paths with their full hashes. Timestamps don't affect identity. Entries are immutable; `unchart` forgets a version rather than editing it.

Before searching, capn selects versions whose complete backing files match and keeps one winner per exact question. QMD indexes only that selected set in an isolated generation under `views/<fingerprint>/`. A generation becomes ready only after indexing succeeds; interrupted builds are retried rather than serving an older selection. Markdown remains authoritative, and derived indexes can be rebuilt.

Commands serialize within a workspace through a process lock. Cleanup removes a missing Git checkout binding only when an accessible Git worktree registry confirms its removal. Missing paths alone, unavailable Git metadata, and locked worktrees don't establish deletion. Cleanup retains discoveries and keeps indexes referenced by surviving bindings; no daemon or filesystem sweep is involved.

## License

MIT
