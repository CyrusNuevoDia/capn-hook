import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { execaSync } from "execa";

export type Checkout = { root: string; commonDir?: string; gitDir?: string };

export function canonical(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  return resolve(
    canonical(dirname(absolute)),
    absolute.slice(dirname(absolute).length + 1)
  );
}

export function contains(root: string, path: string) {
  const part = relative(root, path);
  return (
    part === "" ||
    !(
      part === ".." ||
      part.startsWith(`..${sep}`) ||
      resolve(root, part) !== path
    )
  );
}

export function git(args: string[], cwd: string) {
  return execaSync("git", args, {
    cwd,
    env: { ...process.env, PWD: cwd },
    reject: false,
  });
}

export function checkout(start: string): Checkout {
  const rootResult = git(["rev-parse", "--show-toplevel"], start);
  if (rootResult.exitCode !== 0) {
    // A broken worktree pointer must not silently become an unrelated directory.
    let ancestor = canonical(start);
    while (true) {
      if (existsSync(resolve(ancestor, ".git"))) {
        throw new Error(
          "Cannot resolve Git checkout; repair its Git metadata before using capn."
        );
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        break;
      }
      ancestor = parent;
    }
    return { root: canonical(start) };
  }
  const root = canonical(rootResult.stdout.trim());
  const common = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    root
  );
  const directory = git(["rev-parse", "--absolute-git-dir"], root);
  if (common.exitCode !== 0 || directory.exitCode !== 0) {
    throw new Error(
      "Cannot resolve Git checkout; repair its Git metadata before using capn."
    );
  }
  return {
    root,
    commonDir: canonical(common.stdout.trim()),
    gitDir: canonical(directory.stdout.trim()),
  };
}

export function capnDir() {
  return resolve(homedir(), ".capn");
}
export function configPath() {
  return resolve(capnDir(), "config.json");
}
export function entriesDir(root: string) {
  return resolve(root, "entries");
}
export function entryPath(root: string, id: string) {
  return resolve(entriesDir(root), `${id}.md`);
}
export function qmdDir(root: string) {
  return resolve(root, "qmd");
}
export function qmdDBPath(root: string) {
  return resolve(qmdDir(root), "index.sqlite");
}
