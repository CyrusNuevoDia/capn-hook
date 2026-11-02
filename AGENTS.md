# AGENTS.md — working on capn-hook

Capn Hook is dynamic memory for coding agents: chart immutable discoveries in central workspaces, then recall the versions whose backing-file hashes match the selected checkouts with `capn ask` (QMD hybrid search). Read README.md for the product; this file is how to work on the repo.

## Ground rules

- **The tests are the contract.** GOAL.md is gone — retired before publish (`4c8bbef`); don't go looking for it. `bun test` plus the agent E2E verify behavior. Never weaken or delete a test to make the suite pass — spec changes are explicit, human-approved revisions.
- **Verifier-first workflow:** change the contract docs (README.md) and tests before or with behavior changes, then make `bun test` and the E2E prove it.
- **Chart or unchart, never update** applies to chart entries by design. Do not build entry-mutation features.

## Layout

| Path | What |
| --- | --- |
| `bin/capn`, `src/run.ts`, `src/capn.ts` | Executable launcher, runtime entrypoint, and command dispatch |
| `src/commands.ts` | Command handlers and command-local helpers |
| `src/{workspaces,locks,project,entries,store,hooks,util}.ts` | Central ownership, process locks, checkout pathing, immutable entries, QMD generations, hooks, and utilities |
| `tests/capn.test.ts` | bun:test suite |
| `tests/workspaces.test.ts` | Cross-repository recall, worktree retention, cleanup, and ownership contract |
| `tests/agent-e2e.sh` | Two-phase codex-in-the-loop E2E |
| `tests/treasure-cove/` | Fixture codebase. Must never mention capn — agents under test learn only from `capn context` output |
| `eval/` | Token-cost eval corpus, harness, and committed run evidence. Read `eval/README.md` before touching `eval/run.ts` or running the harness |
| `docs/shaping.md`, `docs/frame.md` | Design history (shaping method) |
| `docs/workspaces.md` | Implemented workspace, version-selection, and cleanup contract |

## Conventions

- Tests are **subprocess-only**: spawn the CLI in mktemp dirs, assert on exit codes/stdout/files. Never import functions from `src/` in tests. Never touch the real `~/.capn/` or the repo's own `.capn/`, `.claude/`, or `.codex/` from tests.
- Tests run **concurrently** (`test.concurrent`): every test mints its own workspace via `workspace()` — own mktemp dir, own `HOME` — and awaits async `execa`. Never `execaSync`, never shared module state between tests. `bun test` discovery is scoped to `tests/` by `bunfig.toml`.
- Tests must pass on a machine with **no GGUF models**: init with `--no-embedding` (BM25). Embedding-path tests must `skipIf` models are absent.
- Chart entries use `chart`/`unchart` naming; the old `add`/`delete` commands are intentionally gone.
- CLI contract (v0.2+): `capn chart "<question>" --files <files> [--details "<extras>"]` — the files ARE the answer; there is no positional answer argument. `capn ask` emits ranked JSONL (one object per line — parse line-by-line, never as a single blob); a miss exits 1 with the hint on stderr. User-visible CLI changes need a changeset.
- Identifier naming: acronyms stay uppercase (`JSON`, `URL`, `DB`); the `Id` suffix stays mixed-case (`entryId`, `sessionId`).
- Keep `src/` flat and lean — storage libs plus one `commands.ts`; no speculative options. The executable package bin stays `bin/capn`; `src/capn.ts` stays importable command dispatch. The `@tobilu/qmd` import stays dynamic inside `openStore`.

## Gotchas (learned the hard way)

- `bun link` does NOT put the `capn` bin on PATH. Symlink the launcher instead: `ln -s "$PWD/bin/capn" <dir-on-PATH>/capn`.
- Authoritative memory lives in `~/.capn/workspaces/<workspace>/entries/`; `~/.capn/config.json` owns workspace membership and checkout bindings. QMD databases live in disposable `views/<fingerprint>/qmd/` generations under each workspace. Never create a project `.capn/` or `.qmd/` directory; the latter belongs to the host's own qmd install (the host-qmd coexistence test guards this).
- **Stale `dist/` masks source changes.** `bin/capn` runs only `dist/capn.js` (it errors if missing — no `src/` fallback). After editing `src/`, run `bun run build` before trusting any subprocess behavior — installed CLI, `capn context` output. (`just install` and the E2E build automatically; `tests/capn.test.ts` spawns `src/run.ts` directly and doesn't need it.) This has burned four separate sessions.
- The launcher resolves its entry from its own realpath, so the capn repo's node_modules is what loads — keep `npm install` or `bun install` fresh there. Bun silently auto-installs from its global cache if no node_modules is found; don't rely on it.
- Hooks are a single command string, `/usr/bin/env capn context`. Codex ignores `args` arrays, and a bare `/usr/bin/env` dumps every env var into session context. Claude hooks belong in `.claude/settings.json`, not `settings.local.json`. Non-interactive `codex exec` (as of 0.142.5) fires no SessionStart hooks at all — inject `capn context` through the prompt instead.
- Broad `rg`/`fd` invocations wander into heavyweight ignored trees (`eval/repos/`, `eval/runs/work/`, `motion/node_modules/`, `motion/out/`) and drown in output — scope commands away from them unless you're working there. (`bun test` is already fenced by `bunfig.toml`.)
- SQLite `-wal`/`-shm` files beside `index.sqlite` are normal; keep the whole generation together. Missing or incomplete generations rebuild from authoritative central Markdown.
- Changed backing files hide discovery versions without deleting them. `capn prune` removes only confirmed dead checkout bindings and unused indexes; it retains discoveries. Existing project-local `.capn/` memory is neither read nor migrated, and `init` doesn't change the project's gitignore.
- Sandboxed builders usually cannot write `.git` — don't attempt commits from a sandbox; the orchestrating session commits.
- BM25 (`qmd search`) needs zero models; hybrid (`qmd query`) needs ~2GB of GGUF models, downloaded on first use and cached globally in `~/.cache/qmd/models`.
- qmd's `bin/qmd` launcher re-spawns node (no bun.lock ships in the published package), and node needs `better-sqlite3` native bindings that a clean `bun install` never builds. Tests spawning the host qmd must bypass the launcher and run `node_modules/@tobilu/qmd/dist/cli/qmd.js` under bun, or it exits 1 on fresh checkouts and CI.

## Commands

```sh
npm install              # deps (@tobilu/qmd; postinstalls build node-llama-cpp)
bun install              # equivalent Bun install path
just install             # bun install + build + symlink bin/capn into ~/.local/bin
bun test                 # fast hermetic suite
bun test -t "<pattern>"  # single test by name filter
bun run build            # bundle src/run.ts -> dist/capn.js (bin/capn runs dist only!)
just fmt                 # ultracite fix — run before committing
just check               # tsgo typecheck + ultracite check + bun test (the CI gate)
sh tests/agent-e2e.sh    # agent E2E — spawns codex twice, costs real LLM calls
```

Run the E2E from a session that can afford LLM spend; don't wire it into reflexive pre-commit automation. It uses `gpt-6.1-terra` unless `CAPN_E2E_MODEL` overrides the model, and verifies successful `capn ask` command events from the later agent.

## Releases

Publishing is owned by GitHub Actions. Pull requests that touch published package inputs need a `.changeset/*.md` file; use an empty changeset for package-adjacent changes that should not bump the version:

```sh
bun changeset
bun changeset --empty
```

When those changes land on `main`, the `release-cli` workflow runs `just check`, applies Changesets, commits any generated version/changelog update back to `main`, publishes `capn-hook` to npm through Trusted Publishing, and tags the published version. Do not publish locally.


# Ultracite Code Standards

This project uses **Ultracite** (Biome) for formatting and linting: `bun x ultracite fix` to format, `bun x ultracite check` to verify — wrapped by `just fmt` / `just check`. Run `fix` before committing; the preset is strict and auto-fixes most issues. Spend review attention on what Biome can't judge: business-logic correctness, naming, API design, edge cases. Don't use `.only`/`.skip` in committed tests.
