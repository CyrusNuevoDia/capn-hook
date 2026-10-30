import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { entriesDir, entryPath } from "./project.ts";
import { atomicWrite, sha256 } from "./util.ts";
import { backingFile, type Context } from "./workspaces.ts";

export type Entry = {
  id: string;
  at: string;
  question: string;
  details: string;
  files: Record<string, string>;
};
export const entryIdPattern = /^[0-9a-f]{16}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const fileLinePattern = /^ {2}("(?:\\.|[^"\\])*"): ([0-9a-f]{64})$/;

export function identity(
  question: string,
  details: string,
  files: Record<string, string>
) {
  return sha256(
    JSON.stringify([
      question,
      details,
      Object.entries(files).sort(([a], [b]) => {
        if (a === b) {
          return 0;
        }
        return a < b ? -1 : 1;
      }),
    ])
  ).slice(0, 16);
}

export function writeEntry(root: string, entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  ${JSON.stringify(path)}: ${entry.files[path]}`)
    .join("\n");
  // JSON preserves exact details (including final newlines) while the body remains searchable Markdown.
  atomicWrite(
    entryPath(root, entry.id),
    `---\ncapn: 2\nid: ${entry.id}\nat: ${entry.at}\ndetails: ${JSON.stringify(entry.details)}\nfiles:\n${files}\n---\n\n# ${entry.question}\n\n${entry.details}\n`
  );
}

export function parseEntry(path: string): Entry {
  const body = readFileSync(path, "utf8");
  const close = body.indexOf("\n---\n", 4);
  if (!body.startsWith("---\n") || close < 0) {
    throw new Error(`Invalid discovery: ${path}`);
  }
  const lines = body.slice(4, close).split("\n");
  const markdown = body.slice(close + 5);
  if (
    lines[0] !== "capn: 2" ||
    !lines[1]?.startsWith("id: ") ||
    !lines[2]?.startsWith("at: ") ||
    !lines[3]?.startsWith("details: ") ||
    lines[4] !== "files:" ||
    !markdown.startsWith("\n# ")
  ) {
    throw new Error(`Invalid discovery: ${path}`);
  }
  const files: Record<string, string> = Object.create(null);
  for (const line of lines.slice(5)) {
    const match = fileLinePattern.exec(line);
    if (!match) {
      throw new Error(`Invalid discovery files: ${path}`);
    }
    const key: unknown = JSON.parse(match[1] ?? "");
    const hash = match[2] ?? "";
    if (
      typeof key !== "string" ||
      Object.hasOwn(files, key) ||
      !hashPattern.test(hash)
    ) {
      throw new Error(`Invalid discovery file: ${path}`);
    }
    files[key] = hash;
  }
  const details: unknown = JSON.parse(lines[3].slice(9));
  const question = markdown.slice(3, markdown.indexOf("\n", 3));
  const id = lines[1].slice(4);
  const at = lines[2].slice(4);
  if (
    typeof details !== "string" ||
    !entryIdPattern.test(id) ||
    !Number.isFinite(Date.parse(at)) ||
    !question ||
    Object.keys(files).length === 0 ||
    identity(question, details, files) !== id ||
    !path.endsWith(`/${id}.md`)
  ) {
    throw new Error(`Invalid discovery identity: ${path}`);
  }
  return { id, at, question, details, files };
}

export function readEntries(root: string) {
  if (!existsSync(entriesDir(root))) {
    return [];
  }
  return readdirSync(entriesDir(root))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => parseEntry(resolve(entriesDir(root), name)));
}

export function deleteEntries(root: string, ids: Set<string>) {
  let count = 0;
  for (const id of ids) {
    if (!entryIdPattern.test(id)) {
      throw new Error("Invalid discovery id");
    }
    const path = entryPath(root, id);
    if (existsSync(path)) {
      rmSync(path);
      count++;
    }
  }
  return count;
}

export function applicable(
  context: Context,
  entries = readEntries(context.root)
) {
  const hashes = new Map<string, string | undefined>();
  const paths = new Map<string, string>();
  const winners = new Map<string, Entry>();
  const matching: Entry[] = [];
  for (const entry of entries) {
    const fresh = Object.entries(entry.files).every(([logical, hash]) => {
      if (!hashes.has(logical)) {
        const absolute = backingFile(context, logical);
        let actual: string | undefined;
        if (absolute) {
          try {
            if (statSync(absolute).isFile()) {
              actual = sha256(readFileSync(absolute));
              paths.set(logical, absolute);
            }
          } catch {
            /* Unavailable evidence hides this discovery. */
          }
        }
        hashes.set(logical, actual);
      }
      return hashes.get(logical) === hash;
    });
    if (!fresh) {
      continue;
    }
    matching.push(entry);
    const previous = winners.get(entry.question);
    if (
      !previous ||
      entry.at > previous.at ||
      (entry.at === previous.at && entry.id > previous.id)
    ) {
      winners.set(entry.question, entry);
    }
  }
  return {
    entries: [...winners.values()].sort((a, b) => a.id.localeCompare(b.id)),
    paths,
    matching,
  };
}
