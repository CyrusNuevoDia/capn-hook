---
"capn-hook": minor
---

Redesign the CLI chart and recall contract: `capn chart` no longer accepts a positional answer and now uses optional `--details`; `capn ask` prints JSONL hits, and misses print the charting hint to stderr with exit code 1.
