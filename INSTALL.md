# Installing capn-hook (for agents)

You are being asked to install capn-hook — dynamic memory for coding agents — into the project you're currently working in. Follow these steps yourself; don't just print them for the human.

## 1. Check if capn is already installed

```sh
command -v capn
```

If this prints a path, skip to step 4 — capn-hook is already installed on this machine, you just need to wire it into the current project.

## 2. Install the CLI

Prefer the published npm package:

```sh
npm install -g capn-hook
```

Or install it with Bun:

```sh
bun install -g capn-hook
```

If npm does not have the needed version yet, use the source checkout:

```sh
git clone https://github.com/CyrusNuevoDia/capn-hook ~/.local/share/capn-hook
cd ~/.local/share/capn-hook
```

If that clone location is already taken by a different checkout, or the human tells you capn-hook lives somewhere else on this machine, `cd` there instead of cloning.

## 3. Build and link the CLI from source

```sh
just install        # or: CAPN_BIN_DIR=/some/path-on-PATH just install
```

Requires [bun](https://bun.sh). Skip this source-link step if `npm install -g capn-hook` or `bun install -g capn-hook` worked. Do not use `bun link` — it does not put `capn` on PATH; `just install` creates the reliable source-checkout symlink.

Confirm it worked:

```sh
command -v capn
```

## 4. Initialize the target project

`cd` back to the project you're actually installing capn-hook into (not the capn-hook checkout), then:

```sh
capn init            # sets up .capn/, capn's QMD index, Claude Code hooks, and Codex hooks
capn init --git      # same, plus a post-commit hook that prunes stale entries
```

Use `capn init --git` if the target project is a git repo. Add `--no-embedding` to either form if you want deterministic BM25-only search and to skip the ~2GB one-time model download:

```sh
capn init --no-embedding
```

## 5. Verify

```sh
capn context
```

should print the ask-first charting contract. Also check that:

- `.claude/settings.local.json` in the target project now has `SessionStart → /usr/bin/env` with args `["capn","context"]`
- `.codex/hooks.json` in the target project now has `SessionStart → /usr/bin/env` with args `["capn","context"]`
- `.capn/` exists in the target project and `.capn/` is gitignored

capn-hook is now live in this project. See [README.md](README.md) for the full command reference (`capn ask`, `capn chart`, `capn reflect`, `capn predict`, `capn reward`, `capn consolidate`, ...).
