import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { execaSync } from "execa";
import { fail } from "./util.ts";

function toPOSIXPath(path: string) {
  return path.split(sep).join("/");
}

function findGitRoot(start: string) {
  const git = execaSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    env: { ...process.env, PWD: start },
    reject: false,
  });
  if (git.exitCode === 0) {
    return git.stdout.trim();
  }
  return resolve(start);
}

export function findProjectRoot(start: string) {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, ".capn"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return findGitRoot(start);
}

export function capnDir(root: string) {
  return resolve(root, ".capn");
}

export function entriesDir(root: string) {
  return resolve(capnDir(root), "entries");
}

export function mapPath(root: string) {
  return resolve(capnDir(root), "map.json");
}

export function configPath(root: string) {
  return resolve(capnDir(root), "config.json");
}

export function entryPath(root: string, id: string) {
  return resolve(entriesDir(root), `${id}.md`);
}

export function qmdDir(root: string) {
  return resolve(capnDir(root), "qmd");
}

export function qmdDBPath(root: string) {
  return resolve(qmdDir(root), "index.sqlite");
}

export function ensureCapn(root: string) {
  mkdirSync(entriesDir(root), { recursive: true });
}

export function relativeFile(root: string, file: string) {
  const absolute = resolve(process.cwd(), file);
  const relativePath = toPOSIXPath(relative(root, absolute));
  if (
    relativePath === "" ||
    relativePath.startsWith("../") ||
    relativePath === ".."
  ) {
    fail(`file is outside project root: ${file}`);
  }
  return { absolute, relativePath };
}

export function config(root: string) {
  try {
    const parsed = JSON.parse(readFileSync(configPath(root), "utf8"));
    return { embedding: parsed.embedding !== false };
  } catch {
    return { embedding: true };
  }
}
