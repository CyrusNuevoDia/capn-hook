---
"capn-hook": patch
---

Scope the `capn context` prompt to repo-answerable questions: anchor the ask-first nudge to codebase-search moments and state that every answer is a set of files in the repo, so agents stop asking capn about live failures or external services (e.g. "why does the CI workflow fail?").
