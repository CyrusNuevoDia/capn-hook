set dotenv-load := true

install:
    #!/usr/bin/env bash
    set -euo pipefail

    bun install

    bin_dir="${CAPN_BIN_DIR:-$HOME/.local/bin}"
    target="$bin_dir/capn"
    mkdir -p "$bin_dir"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
      echo "refusing to overwrite non-symlink: $target" >&2
      echo "remove it or set CAPN_BIN_DIR=/some/path-on-PATH" >&2
      exit 2
    fi

    ln -sfn "$PWD/bin/capn" "$target"
    echo "installed capn -> $target"

    case ":$PATH:" in
      *":$bin_dir:"*) ;;
      *) echo "warning: $bin_dir is not on PATH" >&2 ;;
    esac

fmt:
    bun x ultracite fix

check:
    just lint
    bun test

lint:
    bun x @typescript/native-preview@beta --noEmit --pretty false --skipLibCheck --allowImportingTsExtensions --types bun --module esnext --moduleResolution bundler src/capn.ts src/run.ts tests/capn.test.ts
    bun x ultracite check
