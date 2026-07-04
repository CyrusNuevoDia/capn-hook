#!/usr/bin/env bun
import { createHash, randomBytes } from "node:crypto";
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
import { parseArgs } from "node:util";
import { spawnSync } from "bun";

type Entry = {
  id: string;
  at: string;
  question: string;
  answer: string;
  files: Record<string, string>;
};
type JournalEntry = {
  id: string;
  at: string;
  text: string;
  score?: number;
  rewardedAt?: string;
  observation?: string;
};
type CapnMap = Record<string, { hash: string; entries: string[] }>;
type ClaudeHook = { command?: string; type?: string };
type ClaudeHookGroup = { hooks?: ClaudeHook[] };
type ClaudeSettings = { hooks?: Record<string, ClaudeHookGroup[]> };
type InitOptions = { embedding?: boolean; git: boolean };
type QMDHit = { file?: string; score?: number };
const noChartedAnswer = (question: string) =>
  `No charted answer. Explore, then chart what you find:\n  capn chart "${question}" "<answer with paths>" --files <files>\n`;
const qmdHint =
  "qmd not found. Install with: bun add @tobilu/qmd, or bun install -g @tobilu/qmd\n";
const markdownExtensionPattern = /\.md$/;
const qmdJSONStartPattern = /^\s*[[{]/m;
const journalCollectionBlockPattern = / {2}journal:\n(?: {4}.+\n?)*/;
const trailingNewlinePattern = /\n$/;
function usage() {
  return `Usage:
  capn ask "<question>"
  capn chart "<question>" "<answer>" --files <a,b>
  capn unchart <id>
  capn reflect "<question>"
  capn predict "<prediction>"
  capn reward <id> <0..1> "<observation>"
  capn consolidate [--clear]
  capn bust <path>
  capn prune
  capn list
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
  const git = spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    cwd: start,
    env: { ...process.env, PWD: start },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (git.exitCode === 0) {
    return git.stdout.toString().trim();
  }
  return resolve(start);
}
function findProjectRoot(start: string) {
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
function capnDir(root: string) {
  return resolve(root, ".capn");
}
function entriesDir(root: string) {
  return resolve(capnDir(root), "entries");
}
function journalDir(root: string) {
  return resolve(capnDir(root), "journal");
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
function journalPath(root: string, id: string) {
  return resolve(journalDir(root), `${id}.md`);
}
function ensureCapn(root: string) {
  mkdirSync(entriesDir(root), { recursive: true });
  mkdirSync(journalDir(root), { recursive: true });
}
function ensureJournal(root: string) {
  mkdirSync(journalDir(root), { recursive: true });
}
function relativeFile(root: string, file: string) {
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
function splitFiles(value: string) {
  return value
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}
function parseFiles(args: string[]) {
  const { tokens } = parseArgs({
    args,
    options: { files: { type: "string", multiple: true } },
    strict: false,
    tokens: true,
  });
  return tokens.flatMap((token) =>
    token.kind === "option" &&
    token.name === "files" &&
    typeof token.value === "string"
      ? splitFiles(token.value)
      : []
  );
}
function mapKey(path: string) {
  return path.includes(":") || path.startsWith('"')
    ? JSON.stringify(path)
    : path;
}
function parseMapLine(line: string) {
  const body = line.slice(2);
  if (body.startsWith('"')) {
    for (let index = 1; index < body.length; index++) {
      if (body[index] === '"' && body[index - 1] !== "\\") {
        if (!body.slice(index + 1).startsWith(": ")) {
          throw new Error("bad quoted file key");
        }
        return {
          path: JSON.parse(body.slice(0, index + 1)),
          hash: body.slice(index + 3),
        };
      }
    }
  }
  const separator = body.indexOf(": ");
  if (separator === -1) {
    throw new Error("bad file key");
  }
  return { path: body.slice(0, separator), hash: body.slice(separator + 2) };
}
function writeEntry(root: string, entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  ${mapKey(path)}: ${entry.files[path]}`)
    .join("\n");
  const answer = entry.answer.endsWith("\n")
    ? entry.answer
    : `${entry.answer}\n`;
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
  if (!body.startsWith("---\n")) {
    throw new Error("missing frontmatter");
  }
  const close = body.indexOf("\n---\n", 4);
  if (close === -1) {
    throw new Error("missing frontmatter close");
  }
  const frontmatter = body.slice(4, close).split("\n");
  if (frontmatter[0] !== "capn: 1") {
    throw new Error("bad capn version");
  }
  if (!frontmatter[1]?.startsWith("id: ")) {
    throw new Error("missing id");
  }
  if (!frontmatter[2]?.startsWith("at: ")) {
    throw new Error("missing at");
  }
  if (frontmatter[3] !== "files:") {
    throw new Error("missing files");
  }
  const files: Record<string, string> = {};
  for (const line of frontmatter.slice(4)) {
    if (!line) {
      continue;
    }
    if (!line.startsWith("  ")) {
      throw new Error("bad file line");
    }
    const parsed = parseMapLine(line);
    files[parsed.path] = parsed.hash;
  }
  const markdown = body.slice(close + 5);
  if (!markdown.startsWith("\n# ")) {
    throw new Error("missing title");
  }
  const headingEnd = markdown.indexOf("\n", 1);
  if (headingEnd === -1) {
    throw new Error("missing body");
  }
  let answer = markdown.slice(headingEnd + 1);
  if (answer.startsWith("\n")) {
    answer = answer.slice(1);
  }
  return {
    id: frontmatter[1].slice(4),
    at: frontmatter[2].slice(4),
    files,
    question: markdown.slice(3, headingEnd),
    answer,
  };
}
function readEntries(root: string) {
  if (!existsSync(entriesDir(root))) {
    return [];
  }
  return readdirSync(entriesDir(root))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseEntry(resolve(entriesDir(root), file)));
}
function writeJournalEntry(root: string, entry: JournalEntry) {
  ensureJournal(root);
  const lines = ["---", "capn: 1", `id: ${entry.id}`, `at: ${entry.at}`];
  if (entry.score !== undefined) {
    lines.push(`score: ${entry.score}`);
  }
  if (entry.rewardedAt) {
    lines.push(`rewardedAt: ${entry.rewardedAt}`);
  }
  lines.push("---", "", `# ${entry.text}`);
  if (entry.observation !== undefined) {
    lines.push("", entry.observation);
  }
  writeFileSync(journalPath(root, entry.id), `${lines.join("\n")}\n`);
}
function parseJournalEntry(path: string): JournalEntry {
  const body = readFileSync(path, "utf8");
  if (!body.startsWith("---\n")) {
    throw new Error("missing frontmatter");
  }
  const close = body.indexOf("\n---\n", 4);
  if (close === -1) {
    throw new Error("missing frontmatter close");
  }
  const frontmatter = body.slice(4, close).split("\n");
  if (frontmatter[0] !== "capn: 1") {
    throw new Error("bad capn version");
  }
  if (!frontmatter[1]?.startsWith("id: ")) {
    throw new Error("missing id");
  }
  if (!frontmatter[2]?.startsWith("at: ")) {
    throw new Error("missing at");
  }
  let score: number | undefined;
  let rewardedAt: string | undefined;
  for (const line of frontmatter.slice(3)) {
    if (line.startsWith("score: ")) {
      score = Number(line.slice(7));
      continue;
    }
    if (line.startsWith("rewardedAt: ")) {
      rewardedAt = line.slice(12);
      continue;
    }
    if (line) {
      throw new Error("bad journal frontmatter");
    }
  }
  const markdown = body.slice(close + 5);
  if (!markdown.startsWith("\n# ")) {
    throw new Error("missing title");
  }
  const headingEnd = markdown.indexOf("\n", 1);
  if (headingEnd === -1) {
    throw new Error("missing body");
  }
  let observation: string | undefined;
  const rest = markdown.slice(headingEnd + 1);
  if (rest.startsWith("\n")) {
    observation = rest.slice(1).trimEnd();
  }
  return {
    id: frontmatter[1].slice(4),
    at: frontmatter[2].slice(4),
    text: markdown.slice(3, headingEnd),
    score,
    rewardedAt,
    observation,
  };
}
function readJournalEntries(root: string) {
  if (!existsSync(journalDir(root))) {
    return [];
  }
  return readdirSync(journalDir(root))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseJournalEntry(resolve(journalDir(root), file)));
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
      .map(([path, row]) => [
        path,
        { hash: row.hash, entries: [...new Set(row.entries)].sort() },
      ])
  );
}
function writeMap(root: string, entries = readEntries(root)) {
  ensureCapn(root);
  writeFileSync(
    mapPath(root),
    `${JSON.stringify(buildMap(entries), null, 2)}\n`
  );
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
      return (
        statSync(absolute).isFile() && sha256(readFileSync(absolute)) === hash
      );
    } catch {
      return false;
    }
  });
}
function resolveQMD() {
  let current = dirname(realpathSync(import.meta.path));
  while (true) {
    const candidate = resolve(current, "node_modules/.bin/qmd");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const which = spawnSync({
    cmd: ["which", "qmd"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (which.exitCode === 0) {
    return which.stdout.toString().trim();
  }
  return "";
}
function requireQMD() {
  const qmd = resolveQMD();
  if (!qmd) {
    fail(qmdHint);
  }
  return qmd;
}
function runQMD(root: string, args: string[], qmd = requireQMD()) {
  const result = spawnSync({
    cmd: [qmd, ...args],
    cwd: root,
    env: { ...process.env, PWD: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    fail(
      stderr || result.stdout.toString() || `qmd ${args.join(" ")} failed\n`
    );
  }
  return result.stdout.toString();
}
function parseQMDHits(output: string) {
  const jsonStart = output.search(qmdJSONStartPattern);
  const payload = jsonStart === -1 ? output : output.slice(jsonStart);
  try {
    return JSON.parse(payload || "[]") as QMDHit[];
  } catch {
    fail(`could not parse qmd output: ${output.slice(0, 200)}`);
  }
}
function hasQMDCollection(root: string, name: string) {
  const indexPath = resolve(root, ".qmd/index.yml");
  return (
    existsSync(indexPath) &&
    readFileSync(indexPath, "utf8").includes(`  ${name}:\n`)
  );
}
function hasCapnCollection(root: string, _qmd: string) {
  return hasQMDCollection(root, "capn");
}
function qmdIndex(root: string) {
  const indexPath = resolve(root, ".qmd/index.yml");
  return existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
}
function journalExcludedFromDefaultScope(root: string) {
  const block = qmdIndex(root).match(journalCollectionBlockPattern)?.[0] ?? "";
  return block.includes("includeByDefault: false");
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
    if (warn) {
      process.stderr.write(
        "capn storage updated; run capn init to enable QMD recall\n"
      );
    }
    return;
  }
  const qmd = requireQMD();
  if (!(hasQMDCollection(root, "capn") || hasQMDCollection(root, "journal"))) {
    if (warn) {
      process.stderr.write(
        "capn storage updated; run capn init to enable QMD recall\n"
      );
    }
    return;
  }
  runQMD(root, ["update"], qmd);
  if (embed) {
    runQMD(root, ["embed"], qmd);
  }
}
function deleteEntries(root: string, ids: Set<string>) {
  let count = 0;
  for (const id of ids) {
    const path = entryPath(root, id);
    if (!existsSync(path)) {
      continue;
    }
    rmSync(path);
    count++;
  }
  writeMap(root);
  return count;
}
function prune(root = findProjectRoot(process.cwd()), announce = true) {
  readMap(root);
  const entries = readEntries(root);
  const stale = new Set(
    entries
      .filter((entry) => !entryIsFresh(root, entry))
      .map((entry) => entry.id)
  );
  if (stale.size === 0) {
    writeMap(root, entries);
    return 0;
  }
  const count = deleteEntries(root, stale);
  updateQMDIfReady(root);
  if (announce) {
    process.stdout.write(`pruned ${count} stale entries\n`);
  }
  return count;
}
function chart(args: string[]) {
  const [question, answer] = args;
  const files = parseFiles(args.slice(2));
  if (!(question && answer) || files.length === 0) {
    fail("capn chart requires a question, answer, and --files");
  }
  if (question.includes("\n")) {
    fail("capn chart questions cannot contain newlines");
  }
  const root = findProjectRoot(process.cwd());
  const hashedFiles: Record<string, string> = {};
  for (const file of files) {
    const { absolute, relativePath } = relativeFile(root, file);
    try {
      if (!statSync(absolute).isFile()) {
        throw new Error("not a regular file");
      }
    } catch {
      fail(`missing or not a regular file: ${file}`);
    }
    hashedFiles[relativePath] = sha256(readFileSync(absolute));
  }
  ensureCapn(root);
  const id = sha256(question).slice(0, 8);
  if (existsSync(entryPath(root, id))) {
    rmSync(entryPath(root, id));
  }
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
  if (!question) {
    fail("capn ask requires a question");
  }
  const root = findProjectRoot(process.cwd());
  prune(root, false);
  const qmd = requireQMD();
  if (!hasCapnCollection(root, qmd)) {
    fail("capn recall is not initialized. Run capn init.\n");
  }
  const command = config(root).embedding ? "query" : "search";
  const output = runQMD(
    root,
    [command, question, "-c", "capn", "-n", "5", "--format", "json"],
    qmd
  );
  const hits = parseQMDHits(output);
  const entries = new Map(readEntries(root).map((entry) => [entry.id, entry]));
  const found = hits
    .map((hit) => {
      const file = hit.file || "";
      const id = basename(file).replace(markdownExtensionPattern, "");
      return { entry: entries.get(id), score: Number(hit.score ?? 0) };
    })
    .filter((hit): hit is { entry: Entry; score: number } =>
      Boolean(hit.entry)
    );
  if (found.length === 0) {
    miss(question);
    return;
  }
  for (const hit of found) {
    const score =
      hit.score <= 1 ? Math.round(hit.score * 100) : Math.round(hit.score);
    process.stdout.write(
      `${hit.entry.question}\n${hit.entry.answer.trimEnd()}\nfiles: ${Object.keys(hit.entry.files).join(", ")}\nscore: ${score}%\n\n`
    );
  }
}
function predict(args: string[]) {
  const text = args[0];
  if (!text) {
    fail("capn predict requires prediction text");
  }
  if (text.includes("\n")) {
    fail("capn predict text cannot contain newlines");
  }
  const root = findProjectRoot(process.cwd());
  const at = new Date().toISOString();
  const id = sha256(text + at).slice(0, 8);
  writeJournalEntry(root, { id, at, text });
  updateQMDIfReady(root, config(root).embedding, true);
  process.stdout.write(`predicted ${id}\n`);
}
function reflectMiss() {
  process.stdout.write(
    'No reflections on that yet. When unsure how your user will respond, chart a prediction:\n  capn predict "<compact prediction>"\n'
  );
}
function reflect(args: string[]) {
  const question = args[0];
  if (!question) {
    fail("capn reflect requires a question");
  }
  const root = findProjectRoot(process.cwd());
  const journal = new Map(
    readJournalEntries(root).map((entry) => [entry.id, entry])
  );
  if (journal.size === 0) {
    reflectMiss();
    return;
  }
  const qmd = requireQMD();
  if (!hasQMDCollection(root, "journal")) {
    fail("capn journal recall is not initialized. Run capn init.\n");
  }
  const command = config(root).embedding ? "query" : "search";
  const hits = parseQMDHits(
    runQMD(
      root,
      [command, question, "-c", "journal", "-n", "5", "--format", "json"],
      qmd
    )
  );
  const found = hits
    .map((hit) => {
      const file = hit.file || "";
      const id = basename(file).replace(markdownExtensionPattern, "");
      return { entry: journal.get(id), score: Number(hit.score ?? 0) };
    })
    .filter((hit): hit is { entry: JournalEntry; score: number } =>
      Boolean(hit.entry)
    );
  if (found.length === 0) {
    reflectMiss();
    return;
  }
  for (const hit of found) {
    const relevance =
      hit.score <= 1 ? Math.round(hit.score * 100) : Math.round(hit.score);
    const outcome =
      hit.entry.score === undefined
        ? "(unresolved)"
        : `score: ${hit.entry.score} — ${hit.entry.observation ?? ""}`;
    process.stdout.write(
      `${hit.entry.text}\n${outcome}\nrelevance: ${relevance}%\n\n`
    );
  }
}
function reward(args: string[]) {
  const [id, scoreText, observation] = args;
  if (!(id && scoreText !== undefined && observation !== undefined)) {
    fail("capn reward requires an id, score, and observation");
  }
  const score = Number(scoreText);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    fail("score must be a number from 0 to 1");
  }
  if (observation.length === 0) {
    fail("observation cannot be empty");
  }
  const root = findProjectRoot(process.cwd());
  const path = journalPath(root, id);
  if (!existsSync(path)) {
    fail(`unknown prediction id: ${id}`);
  }
  const entry = parseJournalEntry(path);
  if (entry.score !== undefined) {
    fail(`prediction already rewarded: ${id}`);
  }
  writeJournalEntry(root, {
    ...entry,
    score,
    rewardedAt: new Date().toISOString(),
    observation,
  });
  updateQMDIfReady(root, config(root).embedding, true);
  process.stdout.write(`rewarded ${id} (${score})\n`);
}
function consolidate(args: string[]) {
  const root = findProjectRoot(process.cwd());
  const journal = readJournalEntries(root).sort((left, right) =>
    left.at.localeCompare(right.at)
  );
  if (args[0] === "--clear") {
    ensureJournal(root);
    let count = 0;
    for (const entry of journal) {
      rmSync(journalPath(root, entry.id));
      count++;
    }
    updateQMDIfReady(root);
    process.stdout.write(`cleared ${count} journal entries\n`);
    return;
  }
  if (journal.length === 0) {
    process.stderr.write("nothing to consolidate\n");
    return;
  }
  const mindPath = resolve(capnDir(root), "MIND.md");
  const mindRaw = existsSync(mindPath) ? readFileSync(mindPath, "utf8") : "";
  const mind = mindRaw.trim().length > 0 ? mindRaw : "(none yet)";
  const mindBlock = mind.endsWith("\n") ? mind : `${mind}\n`;
  const resolved = journal
    .filter(
      (entry) =>
        entry.score !== undefined &&
        entry.rewardedAt !== undefined &&
        entry.observation !== undefined
    )
    .map(
      (entry) =>
        `- ${entry.at} predicted: "${entry.text}" → scored ${entry.score} at ${entry.rewardedAt}: ${entry.observation}`
    )
    .join("\n");
  const unresolved = journal
    .filter((entry) => entry.score === undefined)
    .map((entry) => `- ${entry.at} predicted: "${entry.text}"`)
    .join("\n");
  const packet = `# Capn consolidation

You are consolidating a prediction journal into .capn/MIND.md — the charted theory of mind of this project's user. Rewrite .capn/MIND.md as one coherent document, under a page, answering a single question: what does this user expect of an agent working with them?

Rules:
- Surprises are the update signal. A low-score prediction means the previous model was wrong there — rewrite the claims it contradicts; do not append hedges beside them.
- High scores re-license existing claims; they rarely add new ones.
- Unresolved predictions are weak evidence; never treat them as confirmations.
- Every claim must change behavior ("prefers X over Y when Z"), not record trivia.
- Plain claims only — no scores, ids, or timestamps in MIND.md.

When MIND.md is written, run: capn consolidate --clear

## Current MIND.md

${mindBlock}
## Resolved predictions (chronological)

${resolved}

## Unresolved predictions

${unresolved}
`;
  const path = resolve(
    tmpdir(),
    `capn-consolidate-${randomBytes(4).toString("hex")}.md`
  );
  writeFileSync(path, packet);
  process.stdout.write(`${path}\n`);
}
function bust(args: string[]) {
  const file = args[0];
  if (!file) {
    fail("capn bust requires a path");
  }
  const root = findProjectRoot(process.cwd());
  readMap(root);
  const { relativePath } = relativeFile(root, file);
  const ids = new Set(
    readEntries(root)
      .filter((entry) => relativePath in entry.files)
      .map((entry) => entry.id)
  );
  const count = deleteEntries(root, ids);
  if (count > 0) {
    updateQMDIfReady(root);
  }
  process.stdout.write(`busted ${count} entries\n`);
}
function deleteEntry(id: string) {
  if (!id) {
    fail("capn unchart requires an id");
  }
  const root = findProjectRoot(process.cwd());
  const path = entryPath(root, id);
  if (!existsSync(path)) {
    fail(`unknown id: ${id}`);
  }
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
  const root = findProjectRoot(process.cwd());
  const mindPath = resolve(capnDir(root), "MIND.md");
  const hasMind =
    existsSync(mindPath) && readFileSync(mindPath, "utf8").trim().length > 0;
  const mindLine = hasMind
    ? "\nYour user's charted theory of mind is at .capn/MIND.md — read it before judgment calls about approach, style, or scope.\n"
    : "";
  process.stdout.write(`<capn-hook>
This project keeps two memories: a chart of past discoveries (questions earlier sessions answered, and the files backing each answer), and a journal of how your user actually responds.

Thinking about finding something? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the answer and the exact files, skipping the whole search. A miss costs seconds; re-exploring costs minutes.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session:

    capn chart "<question>" "<answer with file paths>" --files <comma-separated files backing it>

Entries whose backing files change are deleted automatically, so when the capn answers, the answer is current. Re-chart a question to replace its entry; never edit entry files by hand.

Model your user, not just the code. When you're genuinely unsure how they'll take something you shipped or proposed, commit to a prediction — then score it once their response lands:

    capn predict "<compact prediction of how the user will respond>"
    capn reward <id> <0..1> "<compact observation of how they actually responded>"

Only surprises teach: skip predictions you'd bet on. Wondering how your user has taken something like this before?

    capn reflect "how does the user feel about new dependencies?"
${mindLine}</capn-hook>
`);
}
function nudge() {
  let payload: { session_id?: string; stop_hook_active?: boolean } = {};
  try {
    const input = readFileSync(0, "utf8").trim();
    if (input) {
      payload = JSON.parse(input);
    }
  } catch {
    payload = {};
  }
  if (payload.stop_hook_active) {
    return;
  }
  const sessionId = payload.session_id || "unknown";
  const marker = resolve(tmpdir(), `capn-nudge-${sha256(sessionId)}`);
  if (existsSync(marker)) {
    return;
  }
  writeFileSync(marker, new Date().toISOString());
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        'Capn\'s log before you go: did this session discover any routes worth charting — where things live, how something works? Chart each with: capn chart "<question>" "<answer with file paths>" --files <files>. Did your user react in a way you did not expect? Log the surprise: capn predict "<what you expected>" then capn reward <id> <0..1> "<what actually happened>". If nothing is worth keeping, just stop again.',
    })
  );
}
function hookCommands(settings: ClaudeSettings, event: string) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups.flatMap((group) =>
    Array.isArray(group?.hooks)
      ? group.hooks
          .map((hook) => hook.command)
          .filter((command): command is string => typeof command === "string")
      : []
  );
}
function addClaudeHook(
  settings: ClaudeSettings,
  event: string,
  command: string
) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  if (
    hookCommands(settings, event).some((existing) => existing.includes("capn "))
  ) {
    return;
  }
  settings.hooks[event].push({
    hooks: [{ type: "command", command }],
  });
}
function installClaudeHooks(root: string) {
  const claudeDir = resolve(root, ".claude");
  const settingsPath = resolve(claudeDir, "settings.json");
  mkdirSync(claudeDir, { recursive: true });
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  }
  addClaudeHook(settings, "SessionStart", "capn context");
  addClaudeHook(settings, "Stop", "capn nudge");
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
function installPostCommit(root: string) {
  const hookPath = resolve(root, ".git/hooks/post-commit");
  const line = "capn prune";
  let body = "";
  mkdirSync(dirname(hookPath), { recursive: true });
  if (existsSync(hookPath)) {
    body = readFileSync(hookPath, "utf8");
  } else {
    body = "#!/bin/sh\n";
  }
  if (!body.includes(line)) {
    body = `${body}${body.endsWith("\n") ? "" : "\n"}${line}\n`;
    writeFileSync(hookPath, body);
  }
  chmodSync(hookPath, 0o755);
}
function ensureGitignore(root: string) {
  const path = resolve(root, ".gitignore");
  const body = existsSync(path) ? readFileSync(path, "utf8") : "";
  const managed = [".qmd/", ".capn/journal/", ".capn/MIND.md"];
  const lines =
    body.length === 0
      ? []
      : body
          .replace(trailingNewlinePattern, "")
          .split("\n")
          .filter((line) => !managed.includes(line));
  lines.push(...managed);
  writeFileSync(path, `${lines.join("\n")}\n`);
}
function parseInitOptions(args: string[]): InitOptions {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      embedding: { type: "boolean" },
      git: { type: "boolean" },
      "no-embedding": { type: "boolean" },
    },
    strict: false,
  });
  let embedding: boolean | undefined;
  if (values["no-embedding"] === true) {
    embedding = false;
  } else if (values.embedding === true) {
    embedding = true;
  }
  return { embedding, git: values.git === true };
}
function writeConfig(root: string, options: InitOptions) {
  const existing = existsSync(configPath(root))
    ? config(root)
    : { embedding: true };
  const embedding = options.embedding ?? existing.embedding;
  writeFileSync(
    configPath(root),
    `${JSON.stringify({ embedding }, null, 2)}\n`
  );
  return embedding;
}
function init(args: string[]) {
  const options = parseInitOptions(args);
  const root = findProjectRoot(process.cwd());
  ensureCapn(root);
  const embedding = writeConfig(root, options);
  ensureGitignore(root);
  const qmd = requireQMD();
  if (!existsSync(resolve(root, ".qmd"))) {
    runQMD(root, ["init"], qmd);
  }
  const collectionList = runQMD(root, ["collection", "list"], qmd);
  if (
    !(collectionList.includes("qmd://capn/") || hasCapnCollection(root, qmd))
  ) {
    runQMD(
      root,
      ["collection", "add", entriesDir(root), "--name", "capn"],
      qmd
    );
  }
  if (
    !(
      collectionList.includes("qmd://journal/") ||
      hasQMDCollection(root, "journal")
    )
  ) {
    runQMD(
      root,
      ["collection", "add", journalDir(root), "--name", "journal"],
      qmd
    );
  }
  if (!journalExcludedFromDefaultScope(root)) {
    runQMD(root, ["collection", "exclude", "journal"], qmd);
  }
  const contextList = runQMD(root, ["context", "list"], qmd);
  if (
    !contextList.includes(
      "Charted discoveries: questions and where their answers live in this codebase"
    )
  ) {
    runQMD(
      root,
      [
        "context",
        "add",
        "qmd://capn",
        "Charted discoveries: questions and where their answers live in this codebase",
      ],
      qmd
    );
  }
  if (
    !contextList.includes(
      "Prediction journal: how the capn expected the user to respond, and what actually happened"
    )
  ) {
    runQMD(
      root,
      [
        "context",
        "add",
        "qmd://journal",
        "Prediction journal: how the capn expected the user to respond, and what actually happened",
      ],
      qmd
    );
  }
  installClaudeHooks(root);
  if (options.git) {
    installPostCommit(root);
  }
  if (embedding) {
    process.stdout.write(
      "embedding enabled; qmd may download its model on first run\n"
    );
    runQMD(root, ["embed"], qmd);
  }
  writeMap(root);
  process.stdout.write(
    `capn initialized: storage, qmd capn and journal collections, hooks${options.git ? ", post-commit" : ""}\n`
  );
}
function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (!command) {
    process.stdout.write(usage());
    process.exit(1);
  }
  if (command === "chart") {
    chart(args);
  } else if (command === "ask") {
    ask(args);
  } else if (command === "reflect") {
    reflect(args);
  } else if (command === "predict") {
    predict(args);
  } else if (command === "reward") {
    reward(args);
  } else if (command === "consolidate") {
    consolidate(args);
  } else if (command === "bust") {
    bust(args);
  } else if (command === "prune") {
    prune();
  } else if (command === "unchart") {
    deleteEntry(args[0]);
  } else if (command === "list") {
    listEntries();
  } else if (command === "context") {
    context();
  } else if (command === "nudge") {
    nudge();
  } else if (command === "init") {
    init(args);
  } else {
    process.stdout.write(usage());
    process.exit(1);
  }
}
main();
