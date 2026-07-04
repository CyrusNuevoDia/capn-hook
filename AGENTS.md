# AGENTS.md — working on capn-hook

Capn Hook is dynamic memory for coding agents: chart discoveries as markdown entries, recall them with `capn ask` (QMD hybrid search), cache-bust by content hash. Read README.md for the product; this file is how to work on the repo.

## Ground rules

- **GOAL.md is the contract.** It is a cold-runnable verifier; the implementation exists to pass it. Never edit GOAL.md to make a failing condition pass — spec changes are explicit, human-approved revisions.
- **Verifier-first workflow:** change the contract docs (GOAL.md/README.md) before or with behavior changes, then make `bun test` and the E2E prove it.
- **Add or delete, never update** applies to chart entries by design. Do not build entry-mutation features.

## Layout

| Path | What |
| --- | --- |
| `src/capn.ts` | The entire CLI. Single executable file, `#!/usr/bin/env bun`, zero npm imports at runtime (qmd is spawned as a binary, never imported) |
| `tests/capn.test.ts` | bun:test suite |
| `tests/agent-e2e.sh` | Two-phase codex-in-the-loop E2E |
| `tests/treasure-cove/` | Fixture codebase. Must never mention capn — agents under test learn only from `capn context` output |
| `GOAL.md` | Cold-audit verifier (v0.2) |
| `docs/shaping.md`, `docs/frame.md` | Design history (shaping method) |

## Conventions

- Tests are **subprocess-only**: spawn the CLI (`Bun.spawnSync`) in mktemp dirs, assert on exit codes/stdout/files. Never import functions from `src/` in tests. Never touch the repo's own `.capn/`, `.claude/`, or `.qmd/` from tests.
- Tests must pass on a machine with **no GGUF models**: init with `--no-embedding` (BM25). Embedding-path tests must `skipIf` models are absent.
- Nudge tests need **fresh random session ids** — nudge markers persist in the OS tmpdir.
- Identifier naming: acronyms stay uppercase (`JSON`, `URL`, `DB`); the `Id` suffix stays mixed-case (`entryId`, `sessionId`).
- Keep `src/capn.ts` lean and single-file; no speculative options.

## Gotchas (learned the hard way)

- `bun link` does NOT put the `capn` bin on PATH. Symlink the shebanged entrypoint instead: `ln -s "$PWD/src/capn.ts" <dir-on-PATH>/capn`.
- qmd is sensitive to the inherited `PWD` env var, not just subprocess cwd — capn pins both to the project root when spawning qmd. Preserve that.
- qmd project-local mode (`.qmd/` from `qmd init`) is what isolates projects; `QMD_CONFIG_DIR` shares one global sqlite and collides on collection names. Don't switch back.
- Sandboxed builders usually cannot write `.git` — don't attempt commits from a sandbox; the orchestrating session commits.
- BM25 (`qmd search`) needs zero models; hybrid (`qmd query`) needs ~2GB of GGUF models, downloaded on first use and cached globally in `~/.cache/qmd/models`.

## Commands

```sh
bun install              # deps (@tobilu/qmd; postinstalls build node-llama-cpp)
bun test                 # fast hermetic suite
sh tests/agent-e2e.sh    # agent E2E — spawns codex twice, costs real LLM calls
```

Run the E2E and any GOAL.md audit from a session that can afford LLM spend; don't wire them into reflexive pre-commit automation.
