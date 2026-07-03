#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

type MapFile = {
  path: string;
  hash: string;
};

type MapEntry = {
  id: string;
  q: string;
  a: string;
  files: MapFile[];
  at: string;
};

function usage() {
  return `Usage:
  captain add "<question>" "<answer>" --files <a,b>
  captain prune
  captain list
  captain delete <id>
  captain context
  captain nudge
  captain init [--git]
`;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function toPOSIXPath(path: string) {
  return path.split(sep).join("/");
}

function findCaptainRoot(start: string) {
  let current = resolve(start);

  while (true) {
    if (existsSync(resolve(current, ".captain"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const git = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: start,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (git.exitCode === 0) return git.stdout.toString().trim();
  return resolve(start);
}

function findGitRoot(start: string) {
  const git = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: start,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (git.exitCode === 0) return git.stdout.toString().trim();
  return resolve(start);
}

function mapPath(root: string) {
  return resolve(root, ".captain/map.jsonl");
}

function ensureMap(root: string) {
  mkdirSync(resolve(root, ".captain"), { recursive: true });
  const path = mapPath(root);
  if (!existsSync(path)) writeFileSync(path, "");
}

function readMap(root: string): MapEntry[] {
  const path = mapPath(root);
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function writeMap(root: string, entries: MapEntry[]) {
  ensureMap(root);
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(mapPath(root), body ? `${body}\n` : "");
}

function parseFiles(args: string[]) {
  const files: string[] = [];

  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--files") continue;
    const value = args[index + 1];
    if (!value) continue;
    files.push(...value.split(",").map((file) => file.trim()).filter(Boolean));
    index++;
  }

  return files;
}

function add(args: string[]) {
  const [question, answer] = args;
  const files = parseFiles(args.slice(2));

  if (!question || !answer || files.length === 0) {
    process.stderr.write("captain add requires a question, answer, and --files\n");
    process.exit(1);
  }

  const root = findCaptainRoot(process.cwd());
  const hashedFiles: MapFile[] = [];

  for (const file of files) {
    const absolute = resolve(process.cwd(), file);

    try {
      if (!statSync(absolute).isFile()) throw new Error("not a regular file");
    } catch {
      process.stderr.write(`missing or not a regular file: ${file}\n`);
      process.exit(1);
    }

    const relativePath = toPOSIXPath(relative(root, absolute));
    hashedFiles.push({
      path: relativePath,
      hash: sha256(readFileSync(absolute)),
    });
  }

  ensureMap(root);
  const id = sha256(question).slice(0, 8);
  const entries = readMap(root).filter((entry) => entry.id !== id);
  entries.push({
    id,
    q: question,
    a: answer,
    files: hashedFiles,
    at: new Date().toISOString(),
  });
  writeMap(root, entries);
  process.stdout.write(`charted ${id}\n`);
}

function entryIsFresh(root: string, entry: MapEntry) {
  return entry.files.every((file) => {
    const absolute = resolve(root, file.path);

    try {
      return statSync(absolute).isFile() && sha256(readFileSync(absolute)) === file.hash;
    } catch {
      return false;
    }
  });
}

function prune(root = findCaptainRoot(process.cwd()), announce = true) {
  const entries = readMap(root);
  const fresh = entries.filter((entry) => entryIsFresh(root, entry));
  const pruned = entries.length - fresh.length;

  if (pruned > 0) {
    writeMap(root, fresh);
    if (announce) process.stdout.write(`pruned ${pruned} stale entries\n`);
  }

  return pruned;
}

function deleteEntry(id: string) {
  if (!id) {
    process.stderr.write("captain delete requires an id\n");
    process.exit(1);
  }

  const root = findCaptainRoot(process.cwd());
  const entries = readMap(root);
  const nextEntries = entries.filter((entry) => entry.id !== id);

  if (nextEntries.length === entries.length) {
    process.stderr.write(`unknown id: ${id}\n`);
    process.exit(1);
  }

  writeMap(root, nextEntries);
}

function formatEntry(entry: MapEntry) {
  const files = entry.files.map((file) => `  - ${file.path}`).join("\n");
  return `${entry.id}
Q: ${entry.q}
A: ${entry.a}
Files:
${files}
`;
}

function chartingContract() {
  return `Charting contract:
When you spend real exploration effort discovering where something lives, you must run:
captain add "<question>" "<answer with paths>" --files <files>
Entries auto-delete when their files change. Re-adding a question replaces it.
If nothing was worth charting, just continue or stop normally.
`;
}

function listEntries() {
  const root = findCaptainRoot(process.cwd());
  process.stdout.write(readMap(root).map(formatEntry).join("\n"));
}

function context() {
  const root = findCaptainRoot(process.cwd());
  prune(root, false);
  const entries = readMap(root);
  const body = entries.length > 0 ? `${entries.map(formatEntry).join("\n")}\n` : "";
  process.stdout.write(`${body}${chartingContract()}`);
}

function nudge() {
  let payload: { session_id?: string; stop_hook_active?: boolean } = {};

  try {
    const input = readFileSync(0, "utf8").trim();
    if (input) payload = JSON.parse(input);
  } catch {
    payload = {};
  }

  if (payload.stop_hook_active) return;

  const sessionId = payload.session_id || "unknown";
  const marker = resolve(tmpdir(), `captain-nudge-${sha256(sessionId)}`);
  if (existsSync(marker)) return;

  writeFileSync(marker, new Date().toISOString());
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        'Before stopping, chart worthwhile discoveries with captain add "<question>" "<answer with paths>" --files <files>. If nothing is worth charting, just stop.',
    }),
  );
}

function hookCommands(settings: any, event: string) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) =>
    Array.isArray(group?.hooks)
      ? group.hooks.map((hook: { command?: string }) => hook.command).filter((command: unknown) => typeof command === "string")
      : [],
  );
}

function addClaudeHook(settings: any, event: string, command: string) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];

  if (hookCommands(settings, event).some((existing) => existing.includes("captain "))) return;

  settings.hooks[event].push({
    hooks: [{ type: "command", command }],
  });
}

function installClaudeHooks(root: string) {
  const claudeDir = resolve(root, ".claude");
  const settingsPath = resolve(claudeDir, "settings.json");
  mkdirSync(claudeDir, { recursive: true });

  let settings: any = {};
  if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, "utf8"));

  addClaudeHook(settings, "SessionStart", "captain context");
  addClaudeHook(settings, "Stop", "captain nudge");
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function installPostCommit(root: string) {
  const hookPath = resolve(root, ".git/hooks/post-commit");
  const line = "captain prune";
  let body = "";

  mkdirSync(dirname(hookPath), { recursive: true });
  if (existsSync(hookPath)) body = readFileSync(hookPath, "utf8");
  else body = "#!/bin/sh\n";

  if (!body.includes(line)) {
    body = `${body}${body.endsWith("\n") ? "" : "\n"}${line}\n`;
    writeFileSync(hookPath, body);
  }

  chmodSync(hookPath, 0o755);
}

function init(args: string[]) {
  const root = findGitRoot(process.cwd());
  ensureMap(root);
  installClaudeHooks(root);
  if (args.includes("--git")) installPostCommit(root);
  process.stdout.write("captain initialized\n");
}

function main() {
  const [command, ...args] = Bun.argv.slice(2);

  if (command === "--help" || command === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }

  if (!command) {
    process.stdout.write(usage());
    process.exit(1);
  }

  if (command === "add") {
    add(args);
    process.exit(0);
  }

  if (command === "prune") {
    prune();
    process.exit(0);
  }

  if (command === "delete") {
    deleteEntry(args[0]);
    process.exit(0);
  }

  if (command === "list") {
    listEntries();
    process.exit(0);
  }

  if (command === "context") {
    context();
    process.exit(0);
  }

  if (command === "nudge") {
    nudge();
    process.exit(0);
  }

  if (command === "init") {
    init(args);
    process.exit(0);
  }

  process.stdout.write(usage());
  process.exit(1);
}

main();
