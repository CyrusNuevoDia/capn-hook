import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { type Entry, writeEntry } from "./entries.ts";
import { atomicWrite, fail, sha256 } from "./util.ts";

export type SearchHit = { file?: string; filepath?: string; score?: number };
export type CapnStore = {
  close: () => Promise<void>;
  embed: (options?: Record<string, unknown>) => Promise<unknown>;
  search: (options: {
    query: string;
    collection: string;
    limit: number;
  }) => Promise<SearchHit[]>;
  searchLex: (
    query: string,
    options: { collection: string; limit: number }
  ) => Promise<SearchHit[]>;
  update: (options?: Record<string, unknown>) => Promise<unknown>;
};
const markdownExtensionPattern = /\.md$/;
const indexFormat = 1;
const qmdVersion = "@tobilu/qmd@2.5.3";

export function hitId(hit: SearchHit) {
  const file = hit.file || hit.filepath || "";
  return basename(file).replace(markdownExtensionPattern, "");
}

export async function openStore(generationRoot: string) {
  let createStore: (options: {
    dbPath: string;
    config: {
      collections: Record<string, { path: string; pattern: string }>;
    };
  }) => Promise<CapnStore>;
  try {
    ({ createStore } = await import("@tobilu/qmd"));
  } catch {
    fail("qmd SDK not available. Run npm install or bun install.\n");
  }
  const qmdRoot = resolve(generationRoot, "qmd");
  mkdirSync(qmdRoot, { recursive: true });
  return createStore({
    dbPath: resolve(qmdRoot, "index.sqlite"),
    config: {
      collections: {
        capn: {
          path: resolve(generationRoot, "entries"),
          pattern: "**/*.md",
        },
      },
    },
  });
}

function hasSQLiteHeader(path: string) {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(16);
    return (
      readSync(descriptor, header, 0, header.length, 0) === header.length &&
      header.toString() === "SQLite format 3\0"
    );
  } finally {
    closeSync(descriptor);
  }
}

function generationIsReady(
  root: string,
  fingerprint: string,
  embedding: boolean
) {
  try {
    const ready = JSON.parse(readFileSync(resolve(root, "ready.json"), "utf8"));
    return (
      ready.format === indexFormat &&
      ready.fingerprint === fingerprint &&
      ready.embedding === embedding &&
      hasSQLiteHeader(resolve(root, "qmd", "index.sqlite"))
    );
  } catch {
    return false;
  }
}

export function discardGeneration(root: string) {
  // SQLite's WAL and SHM siblings belong to the same disposable generation.
  rmSync(root, { recursive: true, force: true });
}

export async function prepareGeneration(
  workspaceRoot: string,
  entries: Entry[],
  embedding: boolean
) {
  const fingerprint = sha256(
    JSON.stringify([
      indexFormat,
      qmdVersion,
      embedding,
      entries.map((entry) => entry.id).sort(),
    ])
  );
  const root = resolve(workspaceRoot, "views", fingerprint);
  if (generationIsReady(root, fingerprint, embedding)) {
    return root;
  }

  discardGeneration(root);
  mkdirSync(resolve(root, "entries"), { recursive: true });
  for (const entry of entries) {
    writeEntry(root, entry);
  }

  // QMD persists the collection path, so build at its final location rather
  // than renaming a temporary SQLite database into a different directory.
  const store = await openStore(root);
  try {
    await store.update({});
    if (embedding) {
      await store.embed({});
    }
  } finally {
    await store.close();
  }

  // Publication is last: an interrupted build can never look reusable.
  atomicWrite(
    resolve(root, "ready.json"),
    `${JSON.stringify({ format: indexFormat, fingerprint, embedding })}\n`
  );
  return root;
}
