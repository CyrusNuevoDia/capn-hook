# capn-hook

## 0.2.1

### Patch Changes

- [`cf7a780`](https://github.com/CyrusNuevoDia/capn-hook/commit/cf7a7804c8980e113dae868b2621e1884a60b00a) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Guide agents to chart smaller, focused discoveries instead of broad context dumps.

- [`5da6600`](https://github.com/CyrusNuevoDia/capn-hook/commit/5da6600d711b87798a9b29f8669a59216da118b6) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Configure Bun's test root so package verification runs the capn suite without discovering eval fixture checkouts.

- [`20a6e5a`](https://github.com/CyrusNuevoDia/capn-hook/commit/20a6e5a89b4a324c110f28f866bdf2c44bd9d058) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Scope the `capn context` prompt to repo-answerable questions: anchor the ask-first nudge to codebase-search moments and state that every answer is a set of files in the repo, so agents stop asking capn about live failures or external services (e.g. "why does the CI workflow fail?").

## 0.2.0

### Minor Changes

- [`e435ccb`](https://github.com/CyrusNuevoDia/capn-hook/commit/e435ccb40ad1b93fa2b846d74c46a9b9dd62dd77) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Redesign the CLI chart and recall contract: `capn chart` no longer accepts a positional answer and now uses optional `--details`; `capn ask` prints JSONL hits, and misses print the charting hint to stderr with exit code 1.

### Patch Changes

- [`0a6bc62`](https://github.com/CyrusNuevoDia/capn-hook/commit/0a6bc62f0f10b800e2ac6550c419e6b3f7bc20df) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Run the capn CLI under Node or Bun and use Execa for subprocess execution.

- [`26f0899`](https://github.com/CyrusNuevoDia/capn-hook/commit/26f08997b3ed7e18227d2c1d79edf5fe2dfdf5ff) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Install SessionStart hooks as one command string so Codex runs `capn context` instead of bare `env`.

- [`4c8bbef`](https://github.com/CyrusNuevoDia/capn-hook/commit/4c8bbefdffa13de290d7e8cef2d9a03fd2eb41bd) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Split src/capn.ts into modules; published tarball now ships the whole src/ directory.

- [`3b9b1aa`](https://github.com/CyrusNuevoDia/capn-hook/commit/3b9b1aa917da00a7d4906e3d3bdca9cbd85ef021) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Disable the prediction journal commands and focus the CLI docs/context on charted codebase recall.

## 0.1.0

Initial public package version.
