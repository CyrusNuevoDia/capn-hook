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

**Selected: C** (A plus the Stop-hook nudge and git-hook pruning). Locked with the user 2026-07-03:

- Recording reinforcement: Stop-hook nudge, once per session (C2)
- Runtime: Bun + TypeScript, single-file CLI, zero deps
- Storage: `.captain/map.jsonl` in the project (JSONL, append-friendly); CLI binary named `captain`
- Prune triggers: SessionStart (before injection), `captain prune` manually, and opt-in git post-commit hook (C3)
- Recall: prune + full-map dump into context at SessionStart (per-prompt matching deferred; see B)

Implementation is verifier-first: [../GOAL.md](../GOAL.md) encodes these decisions as runnable pass/fail conditions; the build happens TDD-style in a separate /goal session against it.

## Detail C: Affordances

| Affordance        | Kind   | Mechanism                                                                              |
| ----------------- | ------ | --------------------------------------------------------------------------------------- |
| `captain add`     | CLI    | `captain add "<q>" "<a>" --files a,b` → sha256 each file, replace same-id entry, append |
| `captain prune`   | CLI    | Re-hash all referenced files; delete entries with any mismatch/missing file             |
| `captain list`    | CLI    | Human-readable map dump                                                                  |
| `captain delete`  | CLI    | Manual cache-bust by entry id                                                            |
| `captain context` | Hook   | SessionStart: prune, then print map + charting contract to stdout (→ agent context)      |
| `captain nudge`   | Hook   | Stop: block once per session (marker in tmpdir keyed by session_id; respects stop_hook_active) |
| `captain init`    | CLI    | Create `.captain/`, merge SessionStart+Stop hooks into `.claude/settings.json`; `--git` installs post-commit prune |
| `.captain/map.jsonl` | Store | One JSON entry per line: `{id, q, a, files: [{path, hash}], at}`; paths relative to project root |
