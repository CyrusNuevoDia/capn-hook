import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureJournal, journalDir, journalPath } from "./project.ts";

export type JournalEntry = {
  id: string;
  at: string;
  text: string;
  score?: number;
  rewardedAt?: string;
  observation?: string;
};

export function writeJournalEntry(root: string, entry: JournalEntry) {
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

export function parseJournalEntry(path: string): JournalEntry {
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

export function readJournalEntries(root: string) {
  if (!existsSync(journalDir(root))) {
    return [];
  }
  return readdirSync(journalDir(root))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseJournalEntry(resolve(journalDir(root), file)));
}
