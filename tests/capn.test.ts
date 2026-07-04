import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "bun";

const capnPath = resolve(import.meta.dir, "../src/capn.ts");
const qmdPath = resolve(
  import.meta.dir,
  "../node_modules/@tobilu/qmd/dist/cli/qmd.js"
);
const predictedIdPattern = /^predicted ([0-9a-f]{8})\n$/;
const isoDatePrefixPattern = /at: \d{4}-\d{2}-\d{2}T/;
const rewardedAtPrefixPattern = /rewardedAt: \d{4}-\d{2}-\d{2}T/;
const scoreLinePattern = /score: \d+%/;
const relevanceLinePattern = /relevance: \d+%/;
const contextHook = { command: "/usr/bin/env", args: ["capn", "context"] };

const contextContract = `<capn-hook>
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
</capn-hook>
`;

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "capn-test-"));
});

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function capn(args: string[] = [], input = "", cwd = workDir) {
  return spawnSync({
    cmd: [capnPath, ...args],
    cwd,
    env: qmdEnv(cwd),
    stdin: input ? Buffer.from(input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function qmdEnv(cwd = workDir, env: Record<string, string> = {}) {
  const {
    XDG_CACHE_HOME: _cache,
    XDG_CONFIG_HOME: _config,
    ...base
  } = process.env;
  return {
    ...base,
    HOME: join(workDir, ".home"),
    PWD: cwd,
    ...env,
  };
}

function run(cmd: string[], cwd = workDir, env: Record<string, string> = {}) {
  return spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: qmdEnv(cwd, env),
  });
}

// qmd's bin launcher re-spawns node, whose sqlite bindings (better-sqlite3)
// a clean `bun install` never builds; run the dist entry under bun so the
// host qmd stays hermetic (bun:sqlite, no native postinstalls).
function qmd(args: string[], cwd = workDir) {
  return run([process.execPath, qmdPath, ...args], cwd);
}

function dotQMDDirs(root: string, current = root): string[] {
  return readdirSync(current)
    .flatMap((name) => {
      const path = join(current, name);
      if (!statSync(path).isDirectory()) {
        return [];
      }
      const relativePath = path.slice(root.length + 1);
      return [
        ...(name === ".qmd" ? [relativePath] : []),
        ...dotQMDDirs(root, path),
      ];
    })
    .sort();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function entryId(question: string) {
  return sha256(question).slice(0, 8);
}

function predictionId(stdout: string) {
  const match = stdout.match(predictedIdPattern);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

function readJSON(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function initNoEmbedding() {
  const result = capn(["init", "--no-embedding"]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

test("prints updated usage for help and rejects missing commands", () => {
  mkdirSync(join(workDir, ".capn"));

  const help = capn(["--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toBe(`Usage:
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
  capn init [--git] [--embedding|--no-embedding]
`);
  expect(help.stdout.toString()).not.toContain("nudge");

  const missing = capn();
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout.toString()).toContain("Usage:");

  const oldAdd = capn(["add", "Q", "A", "--files", "x.ts"]);
  expect(oldAdd.exitCode).toBe(1);
  expect(oldAdd.stdout.toString()).toContain("Usage:");

  const oldDelete = capn(["delete", "ffffffff"]);
  expect(oldDelete.exitCode).toBe(1);
  expect(oldDelete.stdout.toString()).toContain("Usage:");

  const oldNudge = capn(["nudge"]);
  expect(oldNudge.exitCode).toBe(1);
  expect(oldNudge.stdout.toString()).toContain("Usage:");
});

test("chart writes QMD markdown entry and derived map", () => {
  mkdirSync(join(workDir, "src/harbor"), { recursive: true });
  const source = "export function mooringFee() { return 1 }\n";
  writeFileSync(join(workDir, "src/harbor/fees.ts"), source);

  const added = capn([
    "chart",
    "Where are mooring fees calculated?",
    "mooringFee() in src/harbor/fees.ts; invoiced from src/harbor/registry.ts.",
    "--files",
    "src/harbor/fees.ts",
  ]);
  const id = entryId("Where are mooring fees calculated?");

  expect(added.exitCode).toBe(0);
  expect(added.stdout.toString()).toBe(`charted ${id}\n`);
  expect(added.stderr.toString()).toContain("capn init");

  const entry = readFileSync(
    join(workDir, ".capn/entries", `${id}.md`),
    "utf8"
  );
  expect(entry).toContain("---\ncapn: 1\n");
  expect(entry).toContain(`id: ${id}\n`);
  expect(entry).toMatch(isoDatePrefixPattern);
  expect(entry).toContain(
    `files:\n  src/harbor/fees.ts: ${sha256(source)}\n---\n\n`
  );
  expect(entry).toContain("# Where are mooring fees calculated?\n\n");
  expect(entry).toEndWith(
    "mooringFee() in src/harbor/fees.ts; invoiced from src/harbor/registry.ts.\n"
  );

  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/harbor/fees.ts": {
      hash: sha256(source),
      entries: [id],
    },
  });
});

test("chart refuses missing files without writing storage", () => {
  const added = capn([
    "chart",
    "Where is the anchor?",
    "src/anchor.ts",
    "--files",
    "src/anchor.ts",
  ]);

  expect(added.exitCode).toBe(1);
  expect(added.stderr.toString()).toContain(
    "missing or not a regular file: src/anchor.ts"
  );
  expect(existsSync(join(workDir, ".capn"))).toBe(false);
});

test("re-charting the same question replaces the entry and map rows", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const a = 1\n");
  writeFileSync(join(workDir, "src/b.ts"), "export const b = 2\n");

  expect(
    capn(["chart", "Where is X?", "First answer", "--files", "src/a.ts"])
      .exitCode
  ).toBe(0);
  expect(
    capn(["chart", "Where is X?", "Second answer", "--files", "src/b.ts"])
      .exitCode
  ).toBe(0);

  const entries = readdirSync(join(workDir, ".capn/entries"));
  const id = entryId("Where is X?");
  expect(entries).toEqual([`${id}.md`]);
  expect(
    readFileSync(join(workDir, ".capn/entries", `${id}.md`), "utf8")
  ).toContain("Second answer\n");
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/b.ts": {
      hash: sha256("export const b = 2\n"),
      entries: [id],
    },
  });
});

test("chart from a subdirectory stores root-relative POSIX file paths", () => {
  expect(run(["git", "init", "-q"]).exitCode).toBe(0);
  mkdirSync(join(workDir, "src/deep"), { recursive: true });
  writeFileSync(join(workDir, "src/deep/a.ts"), "export const a = 1\n");

  const added = capn(
    ["chart", "Where is deep A?", "src/deep/a.ts", "--files", "a.ts"],
    "",
    join(workDir, "src/deep")
  );

  expect(added.exitCode).toBe(0);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/deep/a.ts": {
      hash: sha256("export const a = 1\n"),
      entries: [entryId("Where is deep A?")],
    },
  });
});

test("ask returns a charted entry through BM25", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(
    join(workDir, "src/payments.ts"),
    "export const webhook = true\n"
  );
  initNoEmbedding();
  expect(
    capn([
      "chart",
      "Where are payment webhooks handled?",
      "They are handled in src/payments.ts.",
      "--files",
      "src/payments.ts",
    ]).exitCode
  ).toBe(0);

  const asked = capn(["ask", "payment webhooks"]);

  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(asked.stdout.toString()).toContain(
    "Where are payment webhooks handled?"
  );
  expect(asked.stdout.toString()).toContain(
    "They are handled in src/payments.ts."
  );
  expect(asked.stdout.toString()).toContain("files: src/payments.ts");
  expect(asked.stdout.toString()).toMatch(scoreLinePattern);
});

test("ask prunes stale entries before recall and prints the miss contract", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 1\n");
  initNoEmbedding();
  expect(
    capn([
      "chart",
      "Where is stale?",
      "In src/stale.ts",
      "--files",
      "src/stale.ts",
    ]).exitCode
  ).toBe(0);
  const id = entryId("Where is stale?");
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 2\n");

  const asked = capn(["ask", "Where is stale?"]);

  expect(asked.exitCode).toBe(0);
  expect(asked.stdout.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn chart "Where is stale?" "<answer with paths>" --files <files>\n'
  );
  expect(existsSync(join(workDir, ".capn/entries", `${id}.md`))).toBe(false);
});

test("ask with no hits prints the no-charted-answer contract", () => {
  initNoEmbedding();

  const asked = capn(["ask", "where is the compass?"]);

  expect(asked.exitCode).toBe(0);
  expect(asked.stdout.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn chart "where is the compass?" "<answer with paths>" --files <files>\n'
  );
});

test("predict writes an unresolved journal entry", () => {
  const predicted = capn([
    "predict",
    "user will accept the QMD dependency without pushback",
  ]);
  const id = predictionId(predicted.stdout.toString());

  expect(predicted.exitCode, predicted.stderr.toString()).toBe(0);
  const journal = readFileSync(
    join(workDir, ".capn/journal", `${id}.md`),
    "utf8"
  );
  expect(journal).toContain("---\ncapn: 1\n");
  expect(journal).toContain(`id: ${id}\n`);
  expect(journal).toMatch(isoDatePrefixPattern);
  expect(journal).not.toContain("score:");
  expect(journal).toEndWith(
    "# user will accept the QMD dependency without pushback\n"
  );
  expect(journal).not.toContain(workDir);
});

test("reward rewrites the same journal entry and rejects invalid rewards without changes", () => {
  const prediction = "user will accept the QMD dependency without pushback";
  const predicted = capn(["predict", prediction]);
  const id = predictionId(predicted.stdout.toString());
  const path = join(workDir, ".capn/journal", `${id}.md`);
  const unresolved = readFileSync(path, "utf8");

  for (const args of [
    ["reward", "ffffffff", "0.2", "asked to vendor it instead"],
    ["reward", id, "1.5", "asked to vendor it instead"],
    ["reward", id, "-0.1", "asked to vendor it instead"],
    ["reward", id, "abc", "asked to vendor it instead"],
    ["reward", id, "0.2", ""],
  ]) {
    const rejected = capn(args);
    expect(rejected.exitCode).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(unresolved);
  }

  const rewarded = capn(["reward", id, "0.2", "asked to vendor it instead"]);
  expect(rewarded.exitCode, rewarded.stderr.toString()).toBe(0);
  expect(rewarded.stdout.toString()).toBe(`rewarded ${id} (0.2)\n`);
  const resolved = readFileSync(path, "utf8");
  expect(resolved).toContain(`id: ${id}\n`);
  expect(resolved).toContain("score: 0.2\n");
  expect(resolved).toMatch(rewardedAtPrefixPattern);
  expect(resolved).toContain(
    `---\n\n# ${prediction}\n\nasked to vendor it instead\n`
  );

  const secondReward = capn(["reward", id, "1", "later confirmed"]);
  expect(secondReward.exitCode).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(resolved);
});

test("reflect searches only the prediction journal and formats resolved and unresolved hits", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/deps.ts"), "export const deps = true\n");
  initNoEmbedding();
  expect(
    capn([
      "chart",
      "Where is dependency policy recorded?",
      "dependency-sentinel chart answer in src/deps.ts",
      "--files",
      "src/deps.ts",
    ]).exitCode
  ).toBe(0);
  const resolvedId = predictionId(
    capn([
      "predict",
      "dependency-sentinel user will reject vendoring qmd",
    ]).stdout.toString()
  );
  expect(
    capn(["reward", resolvedId, "0.2", "asked to vendor it instead"]).exitCode
  ).toBe(0);
  expect(
    capn(["predict", "dependency-sentinel user may accept remote models"])
      .exitCode
  ).toBe(0);

  const reflected = capn(["reflect", "dependency-sentinel"]);
  expect(reflected.exitCode, reflected.stderr.toString()).toBe(0);
  expect(reflected.stdout.toString()).toContain(
    "dependency-sentinel user will reject vendoring qmd"
  );
  expect(reflected.stdout.toString()).toContain(
    "score: 0.2 — asked to vendor it instead"
  );
  expect(reflected.stdout.toString()).toContain(
    "dependency-sentinel user may accept remote models"
  );
  expect(reflected.stdout.toString()).toContain("(unresolved)");
  expect(reflected.stdout.toString()).toMatch(relevanceLinePattern);
  expect(reflected.stdout.toString()).not.toContain("chart answer");

  const asked = capn(["ask", "dependency-sentinel"]);
  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(asked.stdout.toString()).toContain("dependency-sentinel chart answer");
  expect(asked.stdout.toString()).not.toContain(
    "user will reject vendoring qmd"
  );
});

test("reflect with no journal hits prints the prediction miss contract", () => {
  initNoEmbedding();

  const reflected = capn([
    "reflect",
    "how does the user feel about new dependencies?",
  ]);

  expect(reflected.exitCode, reflected.stderr.toString()).toBe(0);
  expect(reflected.stdout.toString()).toBe(
    'No reflections on that yet. When unsure how your user will respond, chart a prediction:\n  capn predict "<compact prediction>"\n'
  );
});

test("consolidate writes a packet with current mind and journal entries, then clears them", () => {
  initNoEmbedding();
  mkdirSync(join(workDir, ".capn"), { recursive: true });
  writeFileSync(
    join(workDir, ".capn/MIND.md"),
    "User prefers narrow patches over broad rewrites.\n"
  );
  const resolvedId = predictionId(
    capn(["predict", "user will accept qmd dependency"]).stdout.toString()
  );
  expect(
    capn(["reward", resolvedId, "0.2", "asked to vendor it instead"]).exitCode
  ).toBe(0);
  expect(capn(["predict", "user may want broader release docs"]).exitCode).toBe(
    0
  );

  const consolidated = capn(["consolidate"]);
  expect(consolidated.exitCode, consolidated.stderr.toString()).toBe(0);
  expect(consolidated.stderr.toString()).toBe("");
  const packetPath = consolidated.stdout.toString().trim();
  expect(consolidated.stdout.toString()).toBe(`${packetPath}\n`);
  expect(packetPath.startsWith(tmpdir())).toBe(true);
  expect(existsSync(packetPath)).toBe(true);
  const packet = readFileSync(packetPath, "utf8");
  expect(packet).toContain("# Capn consolidation\n");
  expect(packet).toContain("Rewrite .capn/MIND.md as one coherent document");
  expect(packet).toContain(
    "When MIND.md is written, run: capn consolidate --clear"
  );
  expect(packet).toContain(
    "## Current MIND.md\n\nUser prefers narrow patches over broad rewrites.\n"
  );
  expect(packet).toContain(
    'predicted: "user will accept qmd dependency" → scored 0.2'
  );
  expect(packet).toContain("asked to vendor it instead");
  expect(packet).toContain('predicted: "user may want broader release docs"');

  const cleared = capn(["consolidate", "--clear"]);
  expect(cleared.exitCode, cleared.stderr.toString()).toBe(0);
  expect(cleared.stdout.toString()).toBe("cleared 2 journal entries\n");
  expect(
    readdirSync(join(workDir, ".capn/journal")).filter((file) =>
      file.endsWith(".md")
    )
  ).toEqual([]);
});

test("consolidate with an empty journal reports nothing to consolidate", () => {
  initNoEmbedding();

  const consolidated = capn(["consolidate"]);

  expect(consolidated.exitCode).toBe(0);
  expect(consolidated.stdout.toString()).toBe("");
  expect(consolidated.stderr.toString()).toContain("nothing to consolidate");
});

test("bust removes entries that cite a file", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  writeFileSync(join(workDir, "src/b.ts"), "b\n");
  expect(
    capn(["chart", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode
  ).toBe(0);
  expect(
    capn(["chart", "Where is B?", "src/b.ts", "--files", "src/b.ts"]).exitCode
  ).toBe(0);

  const busted = capn(["bust", "src/a.ts"]);

  expect(busted.exitCode).toBe(0);
  expect(busted.stdout.toString()).toBe("busted 1 entries\n");
  expect(
    existsSync(join(workDir, ".capn/entries", `${entryId("Where is A?")}.md`))
  ).toBe(false);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/b.ts": {
      hash: sha256("b\n"),
      entries: [entryId("Where is B?")],
    },
  });
});

test("prune is quiet on no-op, reports stale entries, and rebuilds map.json", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  expect(
    capn(["chart", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode
  ).toBe(0);
  rmSync(join(workDir, ".capn/map.json"));

  const fresh = capn(["prune"]);
  expect(fresh.exitCode).toBe(0);
  expect(fresh.stdout.toString()).toBe("");
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/a.ts": {
      hash: sha256("a\n"),
      entries: [entryId("Where is A?")],
    },
  });

  writeFileSync(join(workDir, ".capn/map.json"), "{nope");
  const rebuilt = capn(["bust", "src/missing.ts"]);
  expect(rebuilt.exitCode).toBe(0);
  expect(readJSON(join(workDir, ".capn/map.json"))["src/a.ts"].entries).toEqual(
    [entryId("Where is A?")]
  );

  writeFileSync(join(workDir, "src/a.ts"), "changed\n");
  const stale = capn(["prune"]);
  expect(stale.exitCode).toBe(0);
  expect(stale.stdout.toString()).toBe("pruned 1 stale entries\n");
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
});

test("unchart removes an entry by id and rejects unknown ids", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  expect(
    capn(["chart", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode
  ).toBe(0);

  const unknown = capn(["unchart", "ffffffff"]);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr.toString()).toContain("unknown id: ffffffff");

  const deleted = capn(["unchart", entryId("Where is A?")]);
  expect(deleted.exitCode).toBe(0);
  expect(
    existsSync(join(workDir, ".capn/entries", `${entryId("Where is A?")}.md`))
  ).toBe(false);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
});

test("list prints entries straight from markdown files", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  expect(
    capn(["chart", "Where is A?", "Answer in src/a.ts", "--files", "src/a.ts"])
      .exitCode
  ).toBe(0);
  writeFileSync(join(workDir, ".capn/map.json"), "{}");

  const listed = capn(["list"]);

  expect(listed.exitCode).toBe(0);
  expect(listed.stdout.toString()).toContain(entryId("Where is A?"));
  expect(listed.stdout.toString()).toContain("Q: Where is A?");
  expect(listed.stdout.toString()).toContain("A: Answer in src/a.ts");
  expect(listed.stdout.toString()).toContain("  - src/a.ts");
});

test("context prints the exact static contract", () => {
  mkdirSync(join(workDir, ".capn"));
  const result = capn(["context"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(contextContract);
});

test("context mentions non-empty MIND without leaking stored content or pruning", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(
    join(workDir, "src/context.ts"),
    "export const contextSentinel = 1\n"
  );
  expect(
    capn([
      "chart",
      "Where is context sentinel?",
      "chart-context-sentinel lives in src/context.ts",
      "--files",
      "src/context.ts",
    ]).exitCode
  ).toBe(0);
  const id = entryId("Where is context sentinel?");
  expect(
    capn(["predict", "journal-context-sentinel user will like it"]).exitCode
  ).toBe(0);
  writeFileSync(join(workDir, ".capn/MIND.md"), "mind-context-sentinel\n");
  writeFileSync(
    join(workDir, "src/context.ts"),
    "export const contextSentinel = 2\n"
  );

  const result = capn(["context"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain(
    "Your user's charted theory of mind is at .capn/MIND.md — read it before judgment calls about approach, style, or scope."
  );
  expect(result.stdout.toString()).not.toContain("chart-context-sentinel");
  expect(result.stdout.toString()).not.toContain("journal-context-sentinel");
  expect(result.stdout.toString()).not.toContain("mind-context-sentinel");
  expect(existsSync(join(workDir, ".capn/entries", `${id}.md`))).toBe(true);
});

test("init is idempotent and installs QMD SDK storage, hooks, gitignore, config, and post-commit pruning", () => {
  expect(run(["git", "init", "-q"]).exitCode).toBe(0);
  expect(run(["git", "config", "user.email", "t@t.co"]).exitCode).toBe(0);
  expect(run(["git", "config", "user.name", "t"]).exitCode).toBe(0);

  mkdirSync(join(workDir, ".claude"), { recursive: true });
  writeFileSync(
    join(workDir, ".claude/settings.json"),
    JSON.stringify({ model: "sonnet" })
  );
  writeFileSync(
    join(workDir, ".claude/settings.local.json"),
    JSON.stringify({
      statusLine: { type: "command", command: "echo status" },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo old" }] }],
      },
    })
  );
  mkdirSync(join(workDir, ".codex"), { recursive: true });
  writeFileSync(
    join(workDir, ".codex/hooks.json"),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo codex old" }] }],
      },
    })
  );
  writeFileSync(
    join(workDir, ".gitignore"),
    "dist/\n.capn/qmd/\n.capn/journal/\n.capn/MIND.md\n"
  );

  const first = capn(["init", "--git", "--no-embedding"]);
  expect(first.exitCode, first.stderr.toString()).toBe(0);
  const second = capn(["init", "--git", "--no-embedding"]);
  expect(second.exitCode, second.stderr.toString()).toBe(0);
  expect(first.stdout.toString()).toContain("qmd capn and journal collections");

  expect(readJSON(join(workDir, ".capn/config.json"))).toEqual({
    embedding: false,
  });
  expect(existsSync(join(workDir, ".capn/journal"))).toBe(true);
  expect(existsSync(join(workDir, ".capn/qmd/index.sqlite"))).toBe(true);
  expect(existsSync(join(workDir, ".qmd"))).toBe(false);
  const gitignoreLines = readFileSync(
    join(workDir, ".gitignore"),
    "utf8"
  ).split("\n");
  expect(gitignoreLines.filter((line) => line === "dist/")).toHaveLength(1);
  expect(gitignoreLines.filter((line) => line === ".capn/")).toHaveLength(1);
  expect(gitignoreLines.filter((line) => line === ".capn/qmd/")).toHaveLength(
    0
  );
  expect(gitignoreLines.filter((line) => line === ".qmd/")).toHaveLength(0);
  expect(
    gitignoreLines.filter((line) => line === ".capn/journal/")
  ).toHaveLength(0);
  expect(
    gitignoreLines.filter((line) => line === ".capn/MIND.md")
  ).toHaveLength(0);

  expect(readJSON(join(workDir, ".claude/settings.json"))).toEqual({
    model: "sonnet",
  });
  const settings = readJSON(join(workDir, ".claude/settings.local.json"));
  const codexHooks = readJSON(join(workDir, ".codex/hooks.json"));
  const sessionCommands = settings.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const sessionHooks = settings.hooks.SessionStart.flatMap(
    (group: { hooks: { args?: string[]; command: string }[] }) => group.hooks
  );
  const stopCommands = settings.hooks.Stop.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  expect(
    sessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command &&
        JSON.stringify(hook.args) === JSON.stringify(contextHook.args)
    )
  ).toHaveLength(1);
  expect(sessionCommands).not.toContain("capn context");
  expect(
    stopCommands.filter((command: string) => command.includes("capn "))
  ).toHaveLength(0);
  expect(stopCommands).toContain("echo old");
  expect(settings.model).toBeUndefined();
  expect(settings.statusLine).toEqual({
    type: "command",
    command: "echo status",
  });
  const codexSessionCommands = codexHooks.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const codexSessionHooks = codexHooks.hooks.SessionStart.flatMap(
    (group: { hooks: { args?: string[]; command: string }[] }) => group.hooks
  );
  const codexStopCommands = codexHooks.hooks.Stop.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  expect(
    codexSessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command &&
        JSON.stringify(hook.args) === JSON.stringify(contextHook.args)
    )
  ).toHaveLength(1);
  expect(codexSessionCommands).not.toContain("capn context");
  expect(
    codexStopCommands.filter((command: string) => command.includes("capn "))
  ).toHaveLength(0);
  expect(codexStopCommands).toContain("echo codex old");

  const postCommit = readFileSync(
    join(workDir, ".git/hooks/post-commit"),
    "utf8"
  );
  expect(postCommit).toContain("capn prune");

  const binDir = join(workDir, "bin");
  mkdirSync(binDir);
  symlinkSync(capnPath, join(binDir, "capn"));

  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  expect(
    capn(["chart", "Where is X?", "In src/a.ts", "--files", "src/a.ts"])
      .exitCode
  ).toBe(0);
  const asked = capn(["ask", "Where is X?"]);
  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(asked.stdout.toString()).toContain("In src/a.ts");
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 2\n");

  expect(
    run(["git", "add", "-A"], workDir, {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    }).exitCode
  ).toBe(0);
  const commit = run(["git", "commit", "-m", "x"], workDir, {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  });
  expect(commit.exitCode, commit.stderr.toString()).toBe(0);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
  expect(
    existsSync(join(workDir, ".capn/entries", `${entryId("Where is X?")}.md`))
  ).toBe(false);
});

test("init migrates old Stop nudge hooks without disturbing unrelated Stop hooks", () => {
  const oldNudgeGroup = {
    hooks: [{ type: "command", command: "capn nudge" }],
  };
  const unrelatedStopGroup = {
    hooks: [{ type: "command", command: "echo done" }],
  };
  const unrelatedStopGroupJSON = JSON.stringify(unrelatedStopGroup);

  mkdirSync(join(workDir, ".claude"), { recursive: true });
  writeFileSync(
    join(workDir, ".claude/settings.local.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "capn context" }] },
        ],
        Stop: [oldNudgeGroup, unrelatedStopGroup],
      },
    })
  );
  mkdirSync(join(workDir, ".codex"), { recursive: true });
  writeFileSync(
    join(workDir, ".codex/hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "capn context" }] },
        ],
        Stop: [oldNudgeGroup, unrelatedStopGroup],
      },
    })
  );

  initNoEmbedding();
  initNoEmbedding();

  const settings = readJSON(join(workDir, ".claude/settings.local.json"));
  const codexHooks = readJSON(join(workDir, ".codex/hooks.json"));
  const sessionCommands = settings.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const sessionHooks = settings.hooks.SessionStart.flatMap(
    (group: { hooks: { args?: string[]; command: string }[] }) => group.hooks
  );
  const codexSessionCommands = codexHooks.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const codexSessionHooks = codexHooks.hooks.SessionStart.flatMap(
    (group: { hooks: { args?: string[]; command: string }[] }) => group.hooks
  );

  expect(
    sessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command &&
        JSON.stringify(hook.args) === JSON.stringify(contextHook.args)
    )
  ).toHaveLength(1);
  expect(sessionCommands).not.toContain("capn context");
  expect(
    codexSessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command &&
        JSON.stringify(hook.args) === JSON.stringify(contextHook.args)
    )
  ).toHaveLength(1);
  expect(codexSessionCommands).not.toContain("capn context");
  expect(settings.hooks.Stop).toHaveLength(1);
  expect(codexHooks.hooks.Stop).toHaveLength(1);
  expect(JSON.stringify(settings.hooks.Stop[0])).toBe(unrelatedStopGroupJSON);
  expect(JSON.stringify(codexHooks.hooks.Stop[0])).toBe(unrelatedStopGroupJSON);
  expect(JSON.stringify(settings)).not.toContain("capn nudge");
  expect(JSON.stringify(codexHooks)).not.toContain("capn nudge");
});

test("capn qmd storage coexists with an existing host qmd project", () => {
  mkdirSync(join(workDir, "docs"), { recursive: true });
  writeFileSync(
    join(workDir, "docs/host.md"),
    "# Host Docs\n\nhost-lighthouse-keyword lives only in host qmd.\n"
  );

  const hostConfigPath = join(workDir, ".home/.config/qmd/index.yml");
  const beforeGlobalConfig = existsSync(hostConfigPath)
    ? readFileSync(hostConfigPath, "utf8")
    : undefined;

  const hostInit = qmd(["init"]);
  expect(hostInit.exitCode, hostInit.stderr.toString()).toBe(0);
  const hostAdd = qmd([
    "collection",
    "add",
    join(workDir, "docs"),
    "--name",
    "hostdocs",
  ]);
  expect(hostAdd.exitCode, hostAdd.stderr.toString()).toBe(0);
  const hostUpdate = qmd(["update"]);
  expect(hostUpdate.exitCode, hostUpdate.stderr.toString()).toBe(0);
  const hostIndexPath = join(workDir, ".qmd/index.yml");
  const hostIndex = readFileSync(hostIndexPath);
  expect(dotQMDDirs(workDir)).toEqual([".qmd"]);

  initNoEmbedding();
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/capn.ts"), "export const capn = true\n");
  expect(
    capn([
      "chart",
      "Where is capn-sdk-keyword recorded?",
      "capn-sdk-keyword lives in src/capn.ts.",
      "--files",
      "src/capn.ts",
    ]).exitCode
  ).toBe(0);
  const asked = capn(["ask", "capn-sdk-keyword"]);
  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(asked.stdout.toString()).toContain("capn-sdk-keyword lives");
  expect(asked.stdout.toString()).not.toContain("host-lighthouse-keyword");

  expect(readFileSync(hostIndexPath)).toEqual(hostIndex);
  const hostCollections = qmd(["collection", "list"]);
  expect(hostCollections.exitCode, hostCollections.stderr.toString()).toBe(0);
  expect(hostCollections.stdout.toString()).toContain("hostdocs");
  expect(hostCollections.stdout.toString()).not.toContain("capn");
  expect(hostCollections.stdout.toString()).not.toContain("journal");

  const hostAskedByCapn = capn(["ask", "host-lighthouse-keyword"]);
  expect(hostAskedByCapn.exitCode, hostAskedByCapn.stderr.toString()).toBe(0);
  expect(hostAskedByCapn.stdout.toString()).not.toContain("Host Docs");
  expect(hostAskedByCapn.stdout.toString()).not.toContain(
    "host-lighthouse-keyword lives"
  );

  const capnAskedByHost = qmd(["search", "capn-sdk-keyword"]);
  expect(capnAskedByHost.exitCode, capnAskedByHost.stderr.toString()).toBe(0);
  expect(capnAskedByHost.stdout.toString()).not.toContain("capn-sdk-keyword");
  expect(capnAskedByHost.stdout.toString()).not.toContain("src/capn.ts");

  expect(dotQMDDirs(workDir)).toEqual([".qmd"]);
  if (beforeGlobalConfig === undefined) {
    expect(existsSync(hostConfigPath)).toBe(false);
  } else {
    expect(readFileSync(hostConfigPath, "utf8")).toBe(beforeGlobalConfig);
  }
});
