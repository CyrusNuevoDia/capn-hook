# Installing capn-hook (for agents)

Install capn-hook and initialize the target checkout. Execute these steps yourself instead of printing instructions for the human.

## 1. Check for the CLI

```sh
command -v capn
```

If a path is printed, skip to step 4.

## 2. Install the CLI

```sh
npm install -g capn-hook
# or
bun install -g capn-hook
```

If the required version isn't published, use a source checkout:

```sh
git clone https://github.com/CyrusNuevoDia/capn-hook ~/.local/share/capn-hook
cd ~/.local/share/capn-hook
```

If that location already holds a checkout, or the human provides another location, use it instead of cloning.

## 3. Build and link from source

Skip this step if the package installation succeeded. With Bun installed, run:

```sh
just install        # or: CAPN_BIN_DIR=/some/path-on-PATH just install
command -v capn
```

`just install` builds the launcher target and symlinks the executable. Don't use `bun link`; it doesn't put `capn` on PATH.

## 4. Initialize the target checkout

Return to the checkout receiving the integration, then run:

```sh
capn init
```

For a Git repository, add `--git` to install a post-commit hook that runs `capn prune`. To use keyword search without model downloads, add `--no-embedding`:

```sh
capn init --git --no-embedding
```

If the human named related repositories and a shared workspace, register each checkout with that workspace and a distinct alias:

```sh
capn init --workspace shop --repo api --no-embedding
```

Otherwise, plain `init` creates an isolated workspace or reuses the checkout's registration. Git worktrees inherit the repository's unambiguous workspace owner. Explicit embedding flags change the shared workspace policy; omitted flags preserve it.

## 5. Verify the integration

```sh
capn context
```

Confirm that it prints the ask-first charting instructions, then check:

- The checkout's `.claude/settings.json` has `SessionStart → /usr/bin/env capn context`.
- The checkout's `.codex/hooks.json` has `SessionStart → /usr/bin/env capn context`.
- `~/.capn/config.json` registers the checkout, and the workspace's central storage exists under `~/.capn/workspaces/`.
- If `--git` was used, Git's configured post-commit hook includes `capn prune` and preserves existing hook content.

Memory is central; hooks are checkout-local. Don't create a project `.capn/` directory or change its gitignore for capn. Existing project `.capn/` directories aren't imported or consulted.

See [README.md](README.md) for the command reference and [Central workspaces](docs/workspaces.md) for cross-repository recall and retention.
