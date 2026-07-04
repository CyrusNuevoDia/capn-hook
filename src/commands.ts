import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  deleteEntries,
  type Entry,
  entryIsFresh,
  readEntries,
  readMap,
  writeEntry,
  writeMap,
} from "./entries.ts";
import {
  ensureGitignore,
  installClaudeHooks,
  installCodexHooks,
  installPostCommit,
} from "./hooks.ts";
import {
  type JournalEntry,
  parseJournalEntry,
  readJournalEntries,
  writeJournalEntry,
} from "./journal.ts";
import {
  capnDir,
  config,
  configPath,
  ensureCapn,
  ensureJournal,
  entryPath,
  findProjectRoot,
  journalPath,
  qmdDBPath,
  relativeFile,
} from "./project.ts";
import { hitId, openStore, syncIndex } from "./store.ts";
import { fail, sha256 } from "./util.ts";

type InitOptions = { embedding?: boolean; git: boolean };

const noChartedAnswer = (question: string) =>
  `No charted answer. Explore, then chart what you find:\n  capn chart "${question}" "<answer with paths>" --files <files>\n`;

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

export async function prune(
  root = findProjectRoot(process.cwd()),
  announce = true
) {
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
  await syncIndex(root);
  if (announce) {
    process.stdout.write(`pruned ${count} stale entries\n`);
  }
  return count;
}

export async function chart(args: string[]) {
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
  await syncIndex(root, config(root).embedding, true);
  process.stdout.write(`charted ${id}\n`);
}

function miss(question: string) {
  process.stdout.write(noChartedAnswer(question));
}

export async function ask(args: string[]) {
  const question = args[0];
  if (!question) {
    fail("capn ask requires a question");
  }
  const root = findProjectRoot(process.cwd());
  await prune(root, false);
  if (!existsSync(qmdDBPath(root))) {
    fail("capn recall is not initialized. Run capn init.\n");
  }
  const entries = new Map(readEntries(root).map((entry) => [entry.id, entry]));
  const store = await openStore(root);
  try {
    const hits = await (config(root).embedding
      ? store.search({ query: question, collection: "capn", limit: 5 })
      : store.searchLex(question, { collection: "capn", limit: 5 }));
    const found = hits
      .map((hit) => {
        const id = hitId(hit);
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
  } finally {
    await store.close();
  }
}

export async function predict(args: string[]) {
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
  await syncIndex(root, config(root).embedding, true);
  process.stdout.write(`predicted ${id}\n`);
}

function reflectMiss() {
  process.stdout.write(
    'No reflections on that yet. When unsure how your user will respond, chart a prediction:\n  capn predict "<compact prediction>"\n'
  );
}

export async function reflect(args: string[]) {
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
  if (!existsSync(qmdDBPath(root))) {
    fail("capn journal recall is not initialized. Run capn init.\n");
  }
  const store = await openStore(root);
  try {
    const hits = await (config(root).embedding
      ? store.search({ query: question, collection: "journal", limit: 5 })
      : store.searchLex(question, { collection: "journal", limit: 5 }));
    const found = hits
      .map((hit) => {
        const id = hitId(hit);
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
  } finally {
    await store.close();
  }
}

export async function reward(args: string[]) {
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
  await syncIndex(root, config(root).embedding, true);
  process.stdout.write(`rewarded ${id} (${score})\n`);
}

export async function consolidate(args: string[]) {
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
    await syncIndex(root);
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

export async function bust(args: string[]) {
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
    await syncIndex(root);
  }
  process.stdout.write(`busted ${count} entries\n`);
}

export async function deleteEntry(id: string) {
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
  await syncIndex(root);
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

export function listEntries() {
  const root = findProjectRoot(process.cwd());
  process.stdout.write(readEntries(root).map(formatEntry).join("\n"));
}

export function context() {
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

export async function init(args: string[]) {
  const options = parseInitOptions(args);
  const root = findProjectRoot(process.cwd());
  ensureCapn(root);
  const embedding = writeConfig(root, options);
  ensureGitignore(root);
  const store = await openStore(root);
  const capnContext =
    "Charted discoveries: questions and where their answers live in this codebase";
  const journalContext =
    "Prediction journal: how the capn expected the user to respond, and what actually happened";
  try {
    const contexts = await store.listContexts();
    if (
      !contexts.some(
        (context) =>
          context.collection === "capn" &&
          context.path === "/" &&
          context.context === capnContext
      )
    ) {
      await store.addContext("capn", "/", capnContext);
    }
    if (
      !contexts.some(
        (context) =>
          context.collection === "journal" &&
          context.path === "/" &&
          context.context === journalContext
      )
    ) {
      await store.addContext("journal", "/", journalContext);
    }
    installClaudeHooks(root);
    installCodexHooks(root);
    if (options.git) {
      installPostCommit(root);
    }
    await store.update({});
    if (embedding) {
      process.stdout.write(
        "embedding enabled; qmd may download its model on first run\n"
      );
      await store.embed({});
    }
  } finally {
    await store.close();
  }
  writeMap(root);
  process.stdout.write(
    `capn initialized: storage, qmd capn and journal collections, hooks${options.git ? ", post-commit" : ""}\n`
  );
}
