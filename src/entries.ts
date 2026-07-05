import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ensureCapn, entriesDir, entryPath, mapPath } from "./project.ts";
import { sha256 } from "./util.ts";

export type Entry = {
  id: string;
  at: string;
  question: string;
  details: string;
  files: Record<string, string>;
};
export type CapnMap = Record<string, { hash: string; entries: string[] }>;

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

export function writeEntry(root: string, entry: Entry) {
  const files = Object.keys(entry.files)
    .sort()
    .map((path) => `  ${mapKey(path)}: ${entry.files[path]}`)
    .join("\n");
  const details =
    entry.details === ""
      ? ""
      : `\n${entry.details.endsWith("\n") ? entry.details : `${entry.details}\n`}`;
  const body = `---
capn: 1
id: ${entry.id}
at: ${entry.at}
files:
${files}
---

# ${entry.question}
${details}`;
  writeFileSync(entryPath(root, entry.id), body);
}

export function parseEntry(path: string): Entry {
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
    return {
      id: frontmatter[1].slice(4),
      at: frontmatter[2].slice(4),
      files,
      question: markdown.slice(3),
      details: "",
    };
  }
  let details = markdown.slice(headingEnd + 1);
  if (details.startsWith("\n")) {
    details = details.slice(1);
  }
  return {
    id: frontmatter[1].slice(4),
    at: frontmatter[2].slice(4),
    files,
    question: markdown.slice(3, headingEnd),
    details,
  };
}

export function readEntries(root: string) {
  if (!existsSync(entriesDir(root))) {
    return [];
  }
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
      .map(([path, row]) => [
        path,
        { hash: row.hash, entries: [...new Set(row.entries)].sort() },
      ])
  );
}

export function writeMap(root: string, entries = readEntries(root)) {
  ensureCapn(root);
  writeFileSync(
    mapPath(root),
    `${JSON.stringify(buildMap(entries), null, 2)}\n`
  );
}

export function readMap(root: string): CapnMap {
  try {
    return JSON.parse(readFileSync(mapPath(root), "utf8"));
  } catch {
    writeMap(root);
    return JSON.parse(readFileSync(mapPath(root), "utf8"));
  }
}

export function entryIsFresh(root: string, entry: Entry) {
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

export function deleteEntries(root: string, ids: Set<string>) {
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
