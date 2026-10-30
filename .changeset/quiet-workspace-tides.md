---
"capn-hook": minor
---

Move memory into central workspaces under `~/.capn/`. Group related repositories anywhere on disk with `capn init --workspace <name> --repo <alias>`, or use plain `capn init` for an isolated workspace. Git worktrees inherit their repository's workspace. Existing project-local `.capn/` memory is not automatically migrated.

Retain immutable discovery versions across divergent branches and recall only versions whose complete backing-file hashes match the selected checkouts. Recall returns absolute file paths and the workspace name; 16-character version IDs identify exact discoveries, and `list` includes hidden versions. Isolated QMD generations index only applicable discoveries, recover from interrupted builds, and serialize workspace operations. Cleanup removes confirmed dead checkout bindings and unused indexes while preserving discoveries.

Reject invalid `unchart` IDs before resolving paths, publish complete Markdown atomically, and preserve existing post-commit hooks at Git's configured hook path. Commands that inspect an unregistered checkout leave its ownership untouched so later initialization can choose a named workspace. Agent E2E checks now verify actual successful recall events, and eval grading requires complete backing-file coverage.
