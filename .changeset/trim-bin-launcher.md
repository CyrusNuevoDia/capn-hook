---
"capn-hook": patch
---

Simplify the `capn` launcher: it now always runs the bundled `dist/capn.js` (Bun when available, Node otherwise) and errors clearly if the bundle is missing. The undocumented-in-practice `CAPN_RUNTIME` override and the `src/run.ts` dev fallback are removed.
