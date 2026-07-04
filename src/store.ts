import { existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { entriesDir, journalDir, qmdDBPath, qmdDir } from "./project.ts";
import { fail } from "./util.ts";

export type SearchHit = { file?: string; filepath?: string; score?: number };
export type CapnStore = {
  addContext: (
    collectionName: string,
    pathPrefix: string,
    contextText: string
  ) => Promise<boolean>;
  close: () => Promise<void>;
  embed: (options?: Record<string, unknown>) => Promise<unknown>;
  listContexts: () => Promise<
    Array<{ collection: string; path: string; context: string }>
  >;
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

export function hitId(hit: SearchHit) {
  const file = hit.file || hit.filepath || "";
  return basename(file).replace(markdownExtensionPattern, "");
}

export async function openStore(root: string) {
  let createStore: (options: {
    dbPath: string;
    config: {
      collections: Record<string, { path: string; pattern: string }>;
    };
  }) => Promise<CapnStore>;
  try {
    ({ createStore } = await import("@tobilu/qmd"));
  } catch {
    fail("qmd SDK not available. Run bun install in the capn repo.\n");
  }
  mkdirSync(qmdDir(root), { recursive: true });
  return createStore({
    dbPath: qmdDBPath(root),
    config: {
      collections: {
        capn: { path: entriesDir(root), pattern: "**/*.md" },
        journal: { path: journalDir(root), pattern: "**/*.md" },
      },
    },
  });
}

export async function syncIndex(root: string, embed = false, warn = false) {
  if (!existsSync(qmdDir(root))) {
    if (warn) {
      process.stderr.write(
        "capn storage updated; run capn init to enable QMD recall\n"
      );
    }
    return;
  }
  const store = await openStore(root);
  try {
    await store.update({});
    if (embed) {
      await store.embed({});
    }
  } finally {
    await store.close();
  }
}
