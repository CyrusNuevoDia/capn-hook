# capn-hook

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
