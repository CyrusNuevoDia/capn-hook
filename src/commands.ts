import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  config,
  configPath,
  ensureCapn,
  entryPath,
  findProjectRoot,
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
  process.stdout.write(`<capn-hook>
This project keeps a chart of past discoveries: questions earlier sessions answered, and the files backing each answer.

Thinking about finding something? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the answer and the exact files, skipping the whole search. A miss costs seconds; re-exploring costs minutes.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session:

    capn chart "<question>" "<answer with file paths>" --files <comma-separated files backing it>

Entries whose backing files change are deleted automatically, so when the capn answers, the answer is current. Re-chart a question to replace its entry; never edit entry files by hand.
</capn-hook>
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
    `capn initialized: storage, qmd capn collection, hooks${options.git ? ", post-commit" : ""}\n`
  );
}
