#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
type Entry = {
  id: string;
  at: string;
  question: string;
  answer: string;
  files: Record<string, string>;
};
type CapnMap = Record<string, { hash: string; entries: string[] }>;
const noChartedAnswer = (question: string) =>
  `No charted answer. Explore, then chart what you find:\n  capn add "${question}" "<answer with paths>" --files <files>\n`;
const qmdHint = "qmd not found. Install with: bun add @tobilu/qmd, or bun install -g @tobilu/qmd\n";
function usage() {
  return `Usage:
  capn add "<question>" "<answer>" --files <a,b>
  capn ask "<question>"
  capn bust <path>
  capn prune
  capn list
  capn delete <id>
  capn context
  capn nudge
  capn init [--git] [--embedding|--no-embedding]
`;
}
function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
function toPOSIXPath(path: string) {
  return path.split(sep).join("/");
}
function fail(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}
function findGitRoot(start: string) {
  const git = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: start,
    env: { ...process.env, PWD: start },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (git.exitCode === 0) return git.stdout.toString().trim();
  return resolve(start);
}
function findProjectRoot(start: string) {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, ".capn"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return findGitRoot(start);
}
function capnDir(root: string) {
  return resolve(root, ".capn");
}
function entriesDir(root: string) {
  return resolve(capnDir(root), "entries");
}
function mapPath(root: string) {
  return resolve(capnDir(root), "map.json");
}
function configPath(root: string) {
  return resolve(capnDir(root), "config.json");
}
function entryPath(root: string, id: string) {
  return resolve(entriesDir(root), `${id}.md`);
}
function ensureCapn(root: string) {
  mkdirSync(entriesDir(root), { recursive: true });
}
function relativeFile(root: string, file: string) {
  const absolute = resolve(process.cwd(), file);
  const relativePath = toPOSIXPath(relative(root, absolute));
  if (relativePath === "" || relativePath.startsWith("../") || relativePath === "..") fail(`file is outside project root: ${file}`);
  return { absolute, relativePath };
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
function mapKey(path: string) {
  return path.includes(":") || path.startsWith('"') ? JSON.stringify(path) : path;
}
function parseMapLine(line: string) {
  const body = line.slice(2);
  if (body.startsWith('"')) {
    for (let index = 1; index < body.length; index++) {
      if (body[index] === '"' && body[index - 1] !== "\\") {
        if (!body.slice(index + 1).startsWith(": ")) throw new Error("bad quoted file key");
        return { path: JSON.parse(body.slice(0, index + 1)), hash: body.slice(index + 3) };
      }
    }
  }
  const separator = body.indexOf(": ");
  if (separator === -1) throw new Error("bad file key");
  return { path: body.slice(0, separator), hash: body.slice(separator + 2) };
}
function writeEntry(root: string, entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  ${mapKey(path)}: ${entry.files[path]}`)
    .join("\n");
  const answer = entry.answer.endsWith("\n") ? entry.answer : `${entry.answer}\n`;
  const body = `---
capn: 1
id: ${entry.id}
at: ${entry.at}
files:
${files}
---

# ${entry.question}

${answer}`;
  writeFileSync(entryPath(root, entry.id), body);
}
function parseEntry(path: string): Entry {
  const body = readFileSync(path, "utf8");
  if (!body.startsWith("---\n")) throw new Error("missing frontmatter");
  const close = body.indexOf("\n---\n", 4);
  if (close === -1) throw new Error("missing frontmatter close");
  const frontmatter = body.slice(4, close).split("\n");
  if (frontmatter[0] !== "capn: 1") throw new Error("bad capn version");
  if (!frontmatter[1]?.startsWith("id: ")) throw new Error("missing id");
  if (!frontmatter[2]?.startsWith("at: ")) throw new Error("missing at");
  if (frontmatter[3] !== "files:") throw new Error("missing files");
  const files: Record<string, string> = {};
  for (const line of frontmatter.slice(4)) {
    if (!line) continue;
    if (!line.startsWith("  ")) throw new Error("bad file line");
    const parsed = parseMapLine(line);
    files[parsed.path] = parsed.hash;
  }
  const markdown = body.slice(close + 5);
  if (!markdown.startsWith("\n# ")) throw new Error("missing title");
  const headingEnd = markdown.indexOf("\n", 1);
  if (headingEnd === -1) throw new Error("missing body");
  let answer = markdown.slice(headingEnd + 1);
  if (answer.startsWith("\n")) answer = answer.slice(1);
  return {
    id: frontmatter[1].slice(4),
    at: frontmatter[2].slice(4),
    files,
    question: markdown.slice(3, headingEnd),
    answer,
  };
}
function readEntries(root: string) {
  if (!existsSync(entriesDir(root))) return [];
  return readdirSync(entriesDir(root))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseEntry(resolve(entriesDir(root), file)));
}
function buildMap(entries: Entry[]): CapnMap {
  const map: CapnMap = {};
  for (const entry of entries) {
    for (const [path, hash] of Object.entries(entry.files)) {
      map[path] ??= { hash, entries: [] };
      map[path].hash = hash;
      map[path].entries.push(entry.id);
    }
  }
  return Object.fromEntries(
    Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, row]) => [path, { hash: row.hash, entries: [...new Set(row.entries)].sort() }]),
  );
}
function writeMap(root: string, entries = readEntries(root)) {
  ensureCapn(root);
  writeFileSync(mapPath(root), `${JSON.stringify(buildMap(entries), null, 2)}\n`);
}
function readMap(root: string): CapnMap {
  try {
    return JSON.parse(readFileSync(mapPath(root), "utf8"));
  } catch {
    writeMap(root);
    return JSON.parse(readFileSync(mapPath(root), "utf8"));
  }
}
function entryIsFresh(root: string, entry: Entry) {
  return Object.entries(entry.files).every(([path, hash]) => {
    const absolute = resolve(root, path);
    try {
      return statSync(absolute).isFile() && sha256(readFileSync(absolute)) === hash;
    } catch {
      return false;
    }
  });
}
function resolveQMD() {
  let current = dirname(realpathSync(import.meta.path));
  while (true) {
    const candidate = resolve(current, "node_modules/.bin/qmd");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const which = Bun.spawnSync({ cmd: ["which", "qmd"], stdout: "pipe", stderr: "pipe" });
  if (which.exitCode === 0) return which.stdout.toString().trim();
  return "";
}
function requireQMD() {
  const qmd = resolveQMD();
  if (!qmd) fail(qmdHint);
  return qmd;
}
function runQMD(root: string, args: string[], qmd = requireQMD()) {
  const result = Bun.spawnSync({
    cmd: [qmd, ...args],
    cwd: root,
    env: { ...process.env, PWD: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    fail(stderr || result.stdout.toString() || `qmd ${args.join(" ")} failed\n`);
  }
  return result.stdout.toString();
}
function hasCapnCollection(root: string, _qmd: string) {
  const indexPath = resolve(root, ".qmd/index.yml");
  return existsSync(indexPath) && readFileSync(indexPath, "utf8").includes("  capn:\n");
}
function config(root: string) {
  try {
    const parsed = JSON.parse(readFileSync(configPath(root), "utf8"));
    return { embedding: parsed.embedding !== false };
  } catch {
    return { embedding: true };
  }
}
function updateQMDIfReady(root: string, embed = false, warn = false) {
  if (!existsSync(resolve(root, ".qmd"))) {
    if (warn) process.stderr.write("capn storage updated; run capn init to enable QMD recall\n");
    return;
  }
  const qmd = requireQMD();
  if (!hasCapnCollection(root, qmd)) {
    if (warn) process.stderr.write("capn storage updated; run capn init to enable QMD recall\n");
    return;
  }
  runQMD(root, ["update"], qmd);
  if (embed) runQMD(root, ["embed"], qmd);
}
function deleteEntries(root: string, ids: Set<string>) {
  let count = 0;
  for (const id of ids) {
    const path = entryPath(root, id);
    if (!existsSync(path)) continue;
    rmSync(path);
    count++;
  }
  writeMap(root);
  return count;
}
function prune(root = findProjectRoot(process.cwd()), announce = true) {
  readMap(root);
  const entries = readEntries(root);
  const stale = new Set(entries.filter((entry) => !entryIsFresh(root, entry)).map((entry) => entry.id));
  if (stale.size === 0) {
    writeMap(root, entries);
    return 0;
  }
  const count = deleteEntries(root, stale);
  updateQMDIfReady(root);
  if (announce) process.stdout.write(`pruned ${count} stale entries\n`);
  return count;
}
function add(args: string[]) {
  const [question, answer] = args;
  const files = parseFiles(args.slice(2));
  if (!question || !answer || files.length === 0) fail("capn add requires a question, answer, and --files");
  if (question.includes("\n")) fail("capn add questions cannot contain newlines");
  const root = findProjectRoot(process.cwd());
  const hashedFiles: Record<string, string> = {};
  for (const file of files) {
    const { absolute, relativePath } = relativeFile(root, file);
    try {
      if (!statSync(absolute).isFile()) throw new Error("not a regular file");
    } catch {
      fail(`missing or not a regular file: ${file}`);
    }
    hashedFiles[relativePath] = sha256(readFileSync(absolute));
  }
  ensureCapn(root);
  const id = sha256(question).slice(0, 8);
  if (existsSync(entryPath(root, id))) rmSync(entryPath(root, id));
  writeEntry(root, {
    id,
    question,
    answer,
    files: hashedFiles,
    at: new Date().toISOString(),
  });
  writeMap(root);
  updateQMDIfReady(root, config(root).embedding, true);
  process.stdout.write(`charted ${id}\n`);
}
function miss(question: string) {
  process.stdout.write(noChartedAnswer(question));
}
function ask(args: string[]) {
  const question = args[0];
  if (!question) fail("capn ask requires a question");
  const root = findProjectRoot(process.cwd());
  prune(root, false);
  const qmd = requireQMD();
  if (!hasCapnCollection(root, qmd)) fail("capn recall is not initialized. Run capn init.\n");
  const command = config(root).embedding ? "query" : "search";
  const output = runQMD(root, [command, question, "-c", "capn", "-n", "5", "--format", "json"], qmd);
  const jsonStart = output.search(/^\s*[\[{]/m);
  const payload = jsonStart === -1 ? output : output.slice(jsonStart);
  let hits;
  try {
    hits = JSON.parse(payload || "[]");
  } catch {
    fail(`could not parse qmd output: ${output.slice(0, 200)}`);
  }
  const entries = new Map(readEntries(root).map((entry) => [entry.id, entry]));
  const found = hits
    .map((hit: { file?: string; score?: number }) => {
      const file = hit.file || "";
      const id = basename(file).replace(/\.md$/, "");
      return { entry: entries.get(id), score: Number(hit.score ?? 0) };
    })
    .filter((hit: { entry?: Entry }) => hit.entry);
  if (found.length === 0) {
    miss(question);
    return;
  }
  for (const hit of found) {
    const entry = hit.entry as Entry;
    const score = hit.score <= 1 ? Math.round(hit.score * 100) : Math.round(hit.score);
    process.stdout.write(
      `${entry.question}\n${entry.answer.trimEnd()}\nfiles: ${Object.keys(entry.files).join(", ")}\nscore: ${score}%\n\n`,
    );
  }
}
function bust(args: string[]) {
  const file = args[0];
  if (!file) fail("capn bust requires a path");
  const root = findProjectRoot(process.cwd());
  readMap(root);
  const { relativePath } = relativeFile(root, file);
  const ids = new Set(readEntries(root).filter((entry) => relativePath in entry.files).map((entry) => entry.id));
  const count = deleteEntries(root, ids);
  if (count > 0) updateQMDIfReady(root);
  process.stdout.write(`busted ${count} entries\n`);
}
function deleteEntry(id: string) {
  if (!id) fail("capn delete requires an id");
  const root = findProjectRoot(process.cwd());
  const path = entryPath(root, id);
  if (!existsSync(path)) fail(`unknown id: ${id}`);
  rmSync(path);
  writeMap(root);
  updateQMDIfReady(root);
}
function formatEntry(entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  - ${path}`)
    .join("\n");
  return `${entry.id}
Q: ${entry.question}
A: ${entry.answer.trimEnd()}
Files:
${files}
`;
}
function listEntries() {
  const root = findProjectRoot(process.cwd());
  process.stdout.write(readEntries(root).map(formatEntry).join("\n"));
}
function context() {
  process.stdout.write(`<capn-hook>
This project keeps a chart of past discoveries: questions earlier sessions answered, and the files that back each answer.

Thinking about finding something? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the answer and the exact files, skipping the whole search. A miss costs seconds; re-exploring costs minutes.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session:

    capn add "<question>" "<answer with file paths>" --files <comma-separated files backing it>

Entries whose backing files change are deleted automatically, so when the capn answers, the answer is current. Re-add a question to replace its entry; never edit entry files by hand.
</capn-hook>
`);
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
  const marker = resolve(tmpdir(), `capn-nudge-${sha256(sessionId)}`);
  if (existsSync(marker)) return;
  writeFileSync(marker, new Date().toISOString());
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        'Capn\'s log before you go: did this session discover any routes worth charting - where things live, how something works? Chart each with: capn add "<question>" "<answer with file paths>" --files <files>. If nothing is worth keeping, just stop again.',
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
  if (hookCommands(settings, event).some((existing) => existing.includes("capn "))) return;
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
  addClaudeHook(settings, "SessionStart", "capn context");
  addClaudeHook(settings, "Stop", "capn nudge");
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
function installPostCommit(root: string) {
  const hookPath = resolve(root, ".git/hooks/post-commit");
  const line = "capn prune";
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
function ensureGitignore(root: string) {
  const path = resolve(root, ".gitignore");
  const body = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (body.split("\n").includes(".qmd/")) return;
  writeFileSync(path, `${body}${body && !body.endsWith("\n") ? "\n" : ""}.qmd/\n`);
}
function writeConfig(root: string, args: string[]) {
  const existing = existsSync(configPath(root)) ? config(root) : { embedding: true };
  const embedding = args.includes("--no-embedding") ? false : args.includes("--embedding") ? true : existing.embedding;
  writeFileSync(configPath(root), `${JSON.stringify({ embedding }, null, 2)}\n`);
  return embedding;
}
function init(args: string[]) {
  const root = findProjectRoot(process.cwd());
  ensureCapn(root);
  const embedding = writeConfig(root, args);
  ensureGitignore(root);
  const qmd = requireQMD();
  if (!existsSync(resolve(root, ".qmd"))) runQMD(root, ["init"], qmd);
  const collectionList = runQMD(root, ["collection", "list"], qmd);
  if (!collectionList.includes("qmd://capn/") && !hasCapnCollection(root, qmd)) {
    runQMD(root, ["collection", "add", entriesDir(root), "--name", "capn"], qmd);
  }
  const contextList = runQMD(root, ["context", "list"], qmd);
  if (!contextList.includes("Charted discoveries: questions and where their answers live in this codebase")) {
    runQMD(root, ["context", "add", "qmd://capn", "Charted discoveries: questions and where their answers live in this codebase"], qmd);
  }
  installClaudeHooks(root);
  if (args.includes("--git")) installPostCommit(root);
  if (embedding) {
    process.stdout.write("embedding enabled; qmd may download its model on first run\n");
    runQMD(root, ["embed"], qmd);
  }
  writeMap(root);
  process.stdout.write(`capn initialized: storage, qmd capn collection, hooks${args.includes("--git") ? ", post-commit" : ""}\n`);
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
  if (command === "add") add(args);
  else if (command === "ask") ask(args);
  else if (command === "bust") bust(args);
  else if (command === "prune") prune();
  else if (command === "delete") deleteEntry(args[0]);
  else if (command === "list") listEntries();
  else if (command === "context") context();
  else if (command === "nudge") nudge();
  else if (command === "init") init(args);
  else {
    process.stdout.write(usage());
    process.exit(1);
  }
}
main();
