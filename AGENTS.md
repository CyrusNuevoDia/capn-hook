# AGENTS.md — working on capn-hook

Capn Hook is dynamic memory for coding agents: chart discoveries as markdown entries, recall them with `capn ask` (QMD hybrid search), cache-bust by content hash. Read README.md for the product; this file is how to work on the repo.

## Ground rules

- **GOAL.md is the contract.** It is a cold-runnable verifier; the implementation exists to pass it. Never edit GOAL.md to make a failing condition pass — spec changes are explicit, human-approved revisions.
- **Verifier-first workflow:** change the contract docs (GOAL.md/README.md) before or with behavior changes, then make `bun test` and the E2E prove it.
- **Chart or unchart, never update** applies to chart entries by design. Do not build entry-mutation features.

## Layout

| Path | What |
| --- | --- |
| `src/capn.ts` | The entire CLI. Single executable file, `#!/usr/bin/env bun`, single runtime import: `@tobilu/qmd` (SDK), loaded lazily only by commands that touch the index |
| `tests/capn.test.ts` | bun:test suite |
| `tests/agent-e2e.sh` | Two-phase codex-in-the-loop E2E |
| `tests/treasure-cove/` | Fixture codebase. Must never mention capn — agents under test learn only from `capn context` output |
| `GOAL.md` | Cold-audit verifier (v0.5) |
| `docs/shaping.md`, `docs/frame.md` | Design history (shaping method) |

## Conventions

- Tests are **subprocess-only**: spawn the CLI (`Bun.spawnSync`) in mktemp dirs, assert on exit codes/stdout/files. Never import functions from `src/` in tests. Never touch the repo's own `.capn/`, `.claude/`, `.codex/`, or `.capn/qmd/` from tests.
- Tests must pass on a machine with **no GGUF models**: init with `--no-embedding` (BM25). Embedding-path tests must `skipIf` models are absent.
- Chart entries use `chart`/`unchart` naming; the old `add`/`delete` commands are intentionally gone.
- Identifier naming: acronyms stay uppercase (`JSON`, `URL`, `DB`); the `Id` suffix stays mixed-case (`entryId`, `sessionId`).
- Keep `src/capn.ts` lean and single-file; no speculative options.

## Gotchas (learned the hard way)

- `bun link` does NOT put the `capn` bin on PATH. Symlink the shebanged entrypoint instead: `ln -s "$PWD/src/capn.ts" <dir-on-PATH>/capn`.
- capn's index state lives in `.capn/qmd/index.sqlite` — capn must never create a `.qmd/` at a host project's root; that dir belongs to the host's own qmd install (GOAL group X guards this).
- Bun resolves `@tobilu/qmd` via the symlinked entrypoint's realpath, so the capn repo's node_modules is what loads — keep `bun install` fresh there. Bun silently auto-installs from its global cache if no node_modules is found; don't rely on it.
- sqlite `-wal`/`-shm` files beside `index.sqlite` are normal; the sqlite is disposable — `capn init` rebuilds it from the markdown.
- The whole `.capn/` directory is gitignored local memory (`capn init` manages the line) — tests must not assume any of it is committed.
- Sandboxed builders usually cannot write `.git` — don't attempt commits from a sandbox; the orchestrating session commits.
- BM25 (`qmd search`) needs zero models; hybrid (`qmd query`) needs ~2GB of GGUF models, downloaded on first use and cached globally in `~/.cache/qmd/models`.

## Commands

```sh
bun install              # deps (@tobilu/qmd; postinstalls build node-llama-cpp)
bun test                 # fast hermetic suite
sh tests/agent-e2e.sh    # agent E2E — spawns codex twice, costs real LLM calls
```

Run the E2E and any GOAL.md audit from a session that can afford LLM spend; don't wire them into reflexive pre-commit automation.

## Releases

Publishing is owned by GitHub Actions. Pull requests that touch published package inputs need a `.changeset/*.md` file; use an empty changeset for package-adjacent changes that should not bump the version:

```sh
bun changeset
bun changeset --empty
```

When those changes land on `main`, the `release-cli` workflow runs `just check`, applies Changesets, commits any generated version/changelog update back to `main`, publishes `capn-hook` to npm through Trusted Publishing, and tags the published version. Do not publish locally.


# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.
