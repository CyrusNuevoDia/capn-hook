import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  applicable,
  deleteEntries,
  type Entry,
  entryIdPattern,
  identity,
  readEntries,
  writeEntry,
} from "./entries.ts";
import {
  installClaudeHooks,
  installCodexHooks,
  installPostCommit,
} from "./hooks.ts";
import { checkout, entryPath } from "./project.ts";
import {
  discardGeneration,
  hitId,
  openStore,
  prepareGeneration,
} from "./store.ts";
import { fail, sha256 } from "./util.ts";
import {
  type Context,
  cleanupBindings,
  inWorkspace,
  logicalFile,
  persistBinding,
} from "./workspaces.ts";

const chartSyntax =
  'capn chart "<question>" --files <files> [--details "<extra context>"]';
function miss(question: string) {
  process.stderr.write(
    `No charted answer. Explore, then chart what you find:\n  capn chart "${question}" --files <files> [--details "<extra context>"]\n`
  );
  process.exitCode = 1;
}
function splitFiles(value: string) {
  return value
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}

async function reconcile(context: Context, selection = applicable(context)) {
  const generation = await prepareGeneration(
    context.root,
    selection.entries,
    context.workspace.embedding
  );
  context.binding.generation = basename(generation);
  await persistBinding(context);
  return generation;
}

export async function chart(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      details: { type: "string" },
      files: { type: "string", multiple: true },
    },
  });
  const [question, extra] = positionals;
  const details = values.details ?? "";
  const files = (values.files ?? []).flatMap(splitFiles);
  if (extra !== undefined) {
    fail(
      `capn chart no longer accepts a positional answer. Use:\n  ${chartSyntax}`
    );
  }
  if (!(question && files.length)) {
    fail(`capn chart requires a question and --files. Use:\n  ${chartSyntax}`);
  }
  if (question.includes("\n") || question.includes("\r")) {
    fail("capn chart questions cannot contain newlines");
  }
  let hashes: Record<string, string>;
  await inWorkspace(
    { create: true },
    async (context) => {
      const id = identity(question, details, hashes);
      const path = entryPath(context.root, id);
      if (existsSync(path)) {
        const existing = readEntries(context.root).find(
          (entry) => entry.id === id
        );
        if (
          !existing ||
          existing.question !== question ||
          existing.details !== details ||
          JSON.stringify(Object.entries(existing.files).sort()) !==
            JSON.stringify(Object.entries(hashes).sort())
        ) {
          fail(`Discovery identity collision: ${id}`);
        }
      } else {
        writeEntry(context.root, {
          id,
          question,
          details,
          files: hashes,
          at: new Date().toISOString(),
        });
      }
      if (context.workspace.initialized) {
        await reconcile(context);
      } else {
        process.stderr.write(
          "capn storage updated; run capn init to enable QMD recall\n"
        );
      }
      process.stdout.write(`charted ${id}\n`);
    },
    (context) => {
      hashes = Object.create(null);
      for (const file of files) {
        const { absolute, logical } = logicalFile(context, file);
        if (Object.hasOwn(hashes, logical)) {
          continue;
        }
        try {
          if (!statSync(absolute).isFile()) {
            throw new Error("not a file");
          }
          hashes[logical] = sha256(readFileSync(absolute));
        } catch {
          fail(`missing or not a regular file: ${file}`);
        }
      }
    }
  );
}

function sameSelection(left: Entry[], right: Entry[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry.id === right[index]?.id)
  );
}

async function searchGeneration(
  context: Context,
  generation: string,
  question: string
) {
  const store = await openStore(generation);
  try {
    return await (context.workspace.embedding
      ? store.search({ query: question, collection: "capn", limit: 5 })
      : store.searchLex(question, { collection: "capn", limit: 5 }));
  } finally {
    await store.close();
  }
}

function outputHits(
  context: Context,
  selection: ReturnType<typeof applicable>,
  hits: Awaited<ReturnType<typeof searchGeneration>>,
  question: string
) {
  const entries = new Map(selection.entries.map((entry) => [entry.id, entry]));
  const found = hits.flatMap((hit) => {
    const entry = entries.get(hitId(hit));
    return entry ? [{ entry, score: Number(hit.score ?? 0) }] : [];
  });
  if (!found.length) {
    miss(question);
    return;
  }
  for (const { entry, score } of found) {
    const files = Object.keys(entry.files)
      .map((path) => {
        const absolute = selection.paths.get(path);
        if (!absolute) {
          fail(
            "Backing files changed during recall; retry when the files are stable."
          );
        }
        return absolute;
      })
      .sort();
    process.stdout.write(
      `${JSON.stringify({
        id: entry.id,
        workspace: context.name,
        question: entry.question,
        files,
        ...(entry.details.trimEnd()
          ? { details: entry.details.trimEnd() }
          : {}),
        score: score <= 1 ? Math.round(score * 100) : Math.round(score),
      })}\n`
    );
  }
}

async function recall(context: Context, question: string) {
  if (!context.workspace.initialized) {
    fail("capn recall is not initialized. Run capn init.");
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const selection = applicable(context);
    const generation = await reconcile(context, selection);
    let hits: Awaited<ReturnType<typeof searchGeneration>>;
    try {
      hits = await searchGeneration(context, generation, question);
    } catch (error) {
      discardGeneration(generation);
      if (attempt === 0) {
        continue;
      }
      throw error;
    }
    const verified = applicable(context);
    if (!sameSelection(selection.entries, verified.entries)) {
      if (attempt === 0) {
        continue;
      }
      fail(
        "Backing files changed during recall; retry when the files are stable."
      );
    }
    outputHits(context, verified, hits, question);
    return;
  }
}

export async function ask(args: string[]) {
  const question = args[0];
  if (!question || args.length !== 1) {
    fail("capn ask requires a question");
  }
  await inWorkspace({}, (context) => recall(context, question));
}

export async function bust(args: string[]) {
  const file = args[0];
  if (!file || args.length !== 1) {
    fail("capn bust requires a path");
  }
  await inWorkspace({}, async (context) => {
    const { logical } = logicalFile(context, file);
    const ids = new Set(
      applicable(context)
        .matching.filter((entry) => Object.hasOwn(entry.files, logical))
        .map((entry) => entry.id)
    );
    const count = deleteEntries(context.root, ids);
    if (context.workspace.initialized) {
      await reconcile(context);
    }
    process.stdout.write(`busted ${count} entries\n`);
  });
}

export async function deleteEntry(id: string) {
  if (!id) {
    fail("capn unchart requires an id");
  }
  if (!entryIdPattern.test(id)) {
    fail(`invalid id: ${id}`);
  }
  await inWorkspace({}, async (context) => {
    if (!deleteEntries(context.root, new Set([id]))) {
      fail(`unknown id: ${id}`);
    }
    if (context.workspace.initialized) {
      await reconcile(context);
    }
  });
}

export async function prune() {
  await inWorkspace({}, async (context) => {
    const selection = applicable(context);
    if (context.workspace.initialized) {
      await reconcile(context, selection);
    }
    const count = await cleanupBindings(context);
    process.stdout.write(
      `reconciled ${selection.entries.length} applicable entries; removed ${count} checkout bindings\n`
    );
  });
}

function formatEntry(entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  - ${path}`)
    .join("\n");
  const details = entry.details.trimEnd();
  return `${entry.id}\nQ: ${entry.question}\nFiles:\n${files}\n${details ? `Details:\n${details}\n` : ""}\n`;
}
export async function listEntries() {
  await inWorkspace({}, (context) => {
    process.stdout.write(readEntries(context.root).map(formatEntry).join("\n"));
  });
}

export async function init(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      repo: { type: "string" },
      embedding: { type: "boolean" },
      "no-embedding": { type: "boolean" },
      git: { type: "boolean" },
      help: { type: "boolean" },
      h: { type: "boolean" },
    },
  });
  if (values.help || values.h) {
    process.stdout.write(
      "capn init [--workspace <name>] [--repo <alias>] [--git] [--embedding|--no-embedding]\n"
    );
    return;
  }
  if (positionals.length || (values.embedding && values["no-embedding"])) {
    fail("Invalid capn init options");
  }
  if (values.git && !checkout(process.cwd()).commonDir) {
    fail("capn init --git requires a Git checkout");
  }
  const embedding = values.embedding ? true : undefined;
  await inWorkspace(
    {
      create: true,
      workspace: values.workspace,
      repo: values.repo,
      embedding: values["no-embedding"] ? false : embedding,
      initialize: true,
    },
    async (context) => {
      await reconcile(context);
      installClaudeHooks(context.binding.root);
      installCodexHooks(context.binding.root);
      if (values.git) {
        installPostCommit(context.binding.root);
      }
      process.stdout.write(
        `capn initialized: workspace ${context.name}, repository ${context.binding.alias}, storage, qmd capn collection, hooks${values.git ? ", post-commit" : ""}\n`
      );
    }
  );
}
export function context() {
  process.stdout.write(`<capn-hook>
This workspace keeps a central chart of past discoveries: questions earlier sessions answered, and the files in its related repositories backing each answer.

About to search the codebase — where something lives, how a flow works, which file owns a behavior? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the files that answer it, skipping the whole search. A miss costs seconds; re-exploring costs minutes. Every answer is a set of files, so only ask what a file in this repo could answer — not live failures, external services, or anything you'd debug rather than locate.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session as a small, answerable question:

    capn chart "<question>" --files <comma-separated files backing it> [--details "<line numbers or gotchas>"]

The files ARE the answer; --details is only for extras like line numbers or gotchas. Prefer several atomic charts over one big "context" chart when a discovery contains separable facts, but include multiple files when they jointly answer one focused question. Discoveries apply only while all backing files match this checkout and its companion repositories. Changed files hide a version without deleting it; charting changed evidence creates another immutable version, and reverting restores earlier answers. Never edit entry files by hand.
</capn-hook>
`);
}
