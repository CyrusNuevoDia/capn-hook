---
shaping: true
---

# Captain Hook — Shaping

See [frame.md](frame.md) for problem/outcome.

## Requirements (R)

| ID  | Requirement                                                                                        | Status      |
| --- | -------------------------------------------------------------------------------------------------- | ----------- |
| R0  | Agent can persist discoveries (question → answer hint + file paths) during a session               | Core goal   |
| R1  | Every entry stores content hashes of the files it references                                        | Must-have   |
| R2  | Stale entries (any referenced file changed or deleted) are automatically removed                    | Must-have   |
| R3  | The map from previous sessions is surfaced to the agent in new sessions                             | Must-have   |
| R4  | Add and delete only — no update operation                                                           | Must-have   |
| R5  | Works with Claude Code hooks today; core is agent-agnostic (plain CLI + file format)                | Must-have   |
| R6  | Per-project map; one-command install into a project                                                 | Must-have   |
| R7  | Recording happens without the user having to ask for it                                             | Leaning yes |

## A: CLI + SessionStart injection

The core is a standalone CLI (`captain-hook`); Claude Code integration is a thin hook layer.

| Part | Mechanism                                                                                                    | Flag |
| ---- | ------------------------------------------------------------------------------------------------------------ | :--: |
| A1   | `captain-hook add "<question>" "<answer>" --files a.ts,b.ts` → appends JSONL entry with sha256 per file       |      |
| A2   | `captain-hook prune` → re-hash referenced files, delete entries where any hash mismatches or file is gone     |      |
| A3   | SessionStart hook: run prune, then print map + one-paragraph "when you discover something, run add" contract  |      |
| A4   | `captain-hook init` → writes hook config into project `.claude/settings.json`                                 |      |

## B: A + per-prompt recall (UserPromptSubmit matching)

Same as A, but instead of dumping the whole map at SessionStart, a UserPromptSubmit hook keyword-matches the prompt against stored questions and injects only relevant entries.

| Part | Mechanism                                                              | Flag |
| ---- | ---------------------------------------------------------------------- | :--: |
| B1   | = A1, A2, A4                                                            |      |
| B2   | UserPromptSubmit hook: tokenize prompt, rank entries by keyword overlap | ⚠️   |

## C: A + Stop-hook reflection nudge

Same as A, plus the Stop hook blocks completion once per session asking the agent to record anything it discovered.

| Part | Mechanism                                                                                 | Flag |
| ---- | ------------------------------------------------------------------------------------------ | :--: |
| C1   | = A1–A4                                                                                     |      |
| C2   | Stop hook: first stop of a session returns block + "chart any discoveries worth keeping"   |      |
| C3   | Installable git post-commit hook that runs `captain prune` (opt-in via `captain init --git`) |      |

## Fit Check

| Req | Requirement                                                                          | Status      | A   | B   | C   |
| --- | ------------------------------------------------------------------------------------ | ----------- | --- | --- | --- |
| R0  | Agent can persist discoveries (question → answer hint + file paths) during a session | Core goal   | ✅  | ✅  | ✅  |
| R1  | Every entry stores content hashes of the files it references                          | Must-have   | ✅  | ✅  | ✅  |
| R2  | Stale entries are automatically removed                                               | Must-have   | ✅  | ✅  | ✅  |
| R3  | The map from previous sessions is surfaced in new sessions                            | Must-have   | ✅  | ✅  | ✅  |
| R4  | Add and delete only — no update                                                       | Must-have   | ✅  | ✅  | ✅  |
| R5  | Claude Code today; agent-agnostic core                                                | Must-have   | ✅  | ✅  | ✅  |
| R6  | Per-project map; one-command install                                                  | Must-have   | ✅  | ✅  | ✅  |
| R7  | Recording happens without the user asking                                             | Leaning yes | ❌  | ❌  | ✅  |

**Notes:**

- A, B fail R7: recording relies on the agent remembering the SessionStart contract; no mechanism reinforces it.
- B2 flagged: keyword matching quality is unproven; whole-map injection is fine until maps get large, so B is deferred optimization.

## Decision

**Selected: C** (A plus the Stop-hook nudge and git-hook pruning). Locked with the user 2026-07-03 as the v0.1 baseline:

- Recording reinforcement: Stop-hook nudge, once per session (C2)
- Runtime: Bun + TypeScript, single-file CLI, zero deps
- Storage: `.captain/map.jsonl` in the project (JSONL, append-friendly); CLI binary named `captain`
- Prune triggers: SessionStart (before injection), `captain prune` manually, and opt-in git post-commit hook (C3)
- Recall: prune + full-map dump into context at SessionStart (per-prompt matching deferred; see B)

### v0.2 decision (2026-07-03)

QMD is selected as the Shape B recall mechanism ahead of schedule, per user direction. The Stop-hook nudge and git-hook pruning stay from Shape C; recall changes from SessionStart map dump to on-demand `captain ask`.

| Part | Decision                                                                                     | Flag |
| ---- | --------------------------------------------------------------------------------------------- | :--: |
| D1   | Storage pivots to markdown-per-entry in `.captain/entries/` for human browsability + QMD indexing | 🟡  |
| D2   | `.captain/map.json` becomes a derived reverse index (`file -> entries`) for O(1) file busting | 🟡  |
| D3   | `captain ask` recalls via hybrid `qmd query`; `captain init --no-embedding` uses BM25 `qmd search` | 🟡  |
| D4   | SessionStart prints only the fixed ask-first contract; it does not dump entries or prune      | 🟡  |
| D5   | New commands: `ask`, `bust`; `init` gains `--embedding` / `--no-embedding`                    | 🟡  |
| D6   | Runtime adds the `@tobilu/qmd` dependency; JSONL is dropped with no migration path because no users exist yet | 🟡  |

Implementation is verifier-first: [../GOAL.md](../GOAL.md) v0.2 encodes these decisions as runnable pass/fail conditions; the build happens TDD-style in a separate /goal session against it.

## Detail C: Affordances

| Affordance             | Kind   | Mechanism                                                                                         | Flag |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------- | :--: |
| `captain add`          | CLI    | Write/replace `.captain/entries/<id>.md`, update `.captain/map.json`, then run `qmd update` (+ embed when enabled) | 🟡  |
| `captain ask`          | CLI    | Verify hashes first, delete stale entries, then recall with `qmd query` or BM25 `qmd search`       | 🟡  |
| `captain bust`         | CLI    | Delete every entry referenced by one file path via `.captain/map.json`; exit 0 even on no-op       | 🟡  |
| `captain prune`        | CLI    | Re-hash all referenced files; delete stale entry files, rebuild map, and run `qmd update` only when needed | 🟡  |
| `captain list`         | CLI    | Human-readable dump from markdown entry files                                                       |      |
| `captain delete`       | CLI    | Manual cache-bust by entry id                                                                       |      |
| `captain context`      | Hook   | SessionStart: print only the fixed ask-first charting contract to stdout (→ agent context)          | 🟡  |
| `captain nudge`        | Hook   | Stop: block once per session (marker in tmpdir keyed by session_id; respects stop_hook_active)      |      |
| `captain init`         | CLI    | Create `.captain/entries/`, `.qmd/`, QMD collection/context registration, hooks, config, optional post-commit prune | 🟡  |
| `.captain/entries/*.md` | Store | One markdown entry per question: frontmatter `{captain, id, at, files}` plus `# question` and answer body | 🟡  |
| `.captain/map.json`    | Store | Derived reverse index: `{path: {hash, entries}}`; rebuilt from entry frontmatter if missing/corrupt | 🟡  |
| `.captain/config.json` | Store | Project options, currently `{"embedding": true\|false}`                                            | 🟡  |
| `.qmd/`                | Store | Generated project-local QMD index (`index.yml`, `index.sqlite`); gitignored                         | 🟡  |
