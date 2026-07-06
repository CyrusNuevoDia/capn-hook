import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execaSync } from "execa";

const capnPath = resolve(import.meta.dir, "../src/run.ts");
const qmdPath = resolve(
  import.meta.dir,
  "../node_modules/@tobilu/qmd/dist/cli/qmd.js"
);
const isoDatePrefixPattern = /at: \d{4}-\d{2}-\d{2}T/;
const contextHook = { command: "/usr/bin/env capn context" };
const splitContextHook = { command: "/usr/bin/env", args: ["capn", "context"] };

const contextContract = `<capn-hook>
This project keeps a chart of past discoveries: questions earlier sessions answered, and the files in this repo backing each answer.

About to search the codebase — where something lives, how a flow works, which file owns a behavior? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the files that answer it, skipping the whole search. A miss costs seconds; re-exploring costs minutes. Every answer is a set of files, so only ask what a file in this repo could answer — not live failures, external services, or anything you'd debug rather than locate.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session as a small, answerable question:

    capn chart "<question>" --files <comma-separated files backing it> [--details "<line numbers or gotchas>"]

The files ARE the answer; --details is only for extras like line numbers or gotchas. Prefer several atomic charts over one big "context" chart when a discovery contains separable facts, but include multiple files when they jointly answer one focused question. Entries whose backing files change are deleted automatically, so when the capn answers, the answer is current. Re-chart a question to replace its entry; never edit entry files by hand.
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
  return execaSync(process.execPath, [capnPath, ...args], {
    cwd,
    env: qmdEnv(cwd),
    input: input || undefined,
    reject: false,
    stripFinalNewline: false,
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
  const [file, ...args] = cmd;
  if (file === undefined) {
    throw new Error("run requires a command");
  }
  return execaSync(file, args, {
    cwd,
    env: qmdEnv(cwd, env),
    reject: false,
    stripFinalNewline: false,
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

function readJSON(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseJSONLines(output: string) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
  capn init [--git] [--embedding|--no-embedding]
  capn context
  capn ask "<question>"
  capn chart "<question>" --files <a,b> [--details "<extra context>"]
  capn unchart <id>
  capn bust <path>
  capn prune
  capn list
`);
  expect(help.stdout.toString()).not.toContain("nudge");
  expect(help.stdout.toString()).not.toContain("reflect");
  expect(help.stdout.toString()).not.toContain("predict");
  expect(help.stdout.toString()).not.toContain("reward");

  const missing = capn();
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout.toString()).toContain("Usage:");

  for (const args of [
    ["add", "Q", "A", "--files", "x.ts"],
    ["delete", "ffffffff"],
    ["nudge"],
    ["reflect", "how does the user feel about new dependencies?"],
    ["predict", "user will want two commits"],
    ["reward", "ffffffff", "0.5", "maybe"],
    ["consolidate"],
  ]) {
    const unsupported = capn(args);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stdout.toString()).toContain("Usage:");
  }
});

test("chart writes QMD markdown entry and derived map", () => {
  mkdirSync(join(workDir, "src/harbor"), { recursive: true });
  const source = "export function mooringFee() { return 1 }\n";
  writeFileSync(join(workDir, "src/harbor/fees.ts"), source);

  const added = capn([
    "chart",
    "Where are mooring fees calculated?",
    "--files",
    "src/harbor/fees.ts",
    "--details",
    "mooringFee() in src/harbor/fees.ts; invoiced from src/harbor/registry.ts.",
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
    "--files",
    "src/anchor.ts",
  ]);

  expect(added.exitCode).toBe(1);
  expect(added.stderr.toString()).toContain(
    "missing or not a regular file: src/anchor.ts"
  );
  expect(existsSync(join(workDir, ".capn"))).toBe(false);
});

test("chart rejects legacy positional answer syntax", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");

  const added = capn([
    "chart",
    "Where is A?",
    "Old positional answer",
    "--files",
    "src/a.ts",
  ]);

  expect(added.exitCode).toBe(1);
  expect(added.stderr.toString()).toContain(
    'capn chart "<question>" --files <files> [--details "<extra context>"]'
  );
  expect(existsSync(join(workDir, ".capn"))).toBe(false);
});

test("re-charting the same question replaces the entry and map rows", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const a = 1\n");
  writeFileSync(join(workDir, "src/b.ts"), "export const b = 2\n");

  expect(
    capn([
      "chart",
      "Where is X?",
      "--files",
      "src/a.ts",
      "--details",
      "First details",
    ]).exitCode
  ).toBe(0);
  expect(
    capn([
      "chart",
      "Where is X?",
      "--files",
      "src/b.ts",
      "--details",
      "Second details",
    ]).exitCode
  ).toBe(0);

  const entries = readdirSync(join(workDir, ".capn/entries"));
  const id = entryId("Where is X?");
  expect(entries).toEqual([`${id}.md`]);
  expect(
    readFileSync(join(workDir, ".capn/entries", `${id}.md`), "utf8")
  ).toContain("Second details\n");
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
    ["chart", "Where is deep A?", "--files", "a.ts"],
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
      "--files",
      "src/payments.ts",
      "--details",
      "They are handled in src/payments.ts.",
    ]).exitCode
  ).toBe(0);

  const asked = capn(["ask", "payment webhooks"]);

  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  const hits = parseJSONLines(asked.stdout.toString());
  expect(hits).toHaveLength(1);
  expect(hits[0]).toEqual({
    id: entryId("Where are payment webhooks handled?"),
    question: "Where are payment webhooks handled?",
    files: ["src/payments.ts"],
    details: "They are handled in src/payments.ts.",
    score: expect.any(Number),
  });
  expect(hits[0].score).toBeGreaterThanOrEqual(0);
  expect(hits[0].score).toBeLessThanOrEqual(100);
});

test("ask omits details when a charted entry has none", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/empty.ts"), "export const empty = true\n");
  initNoEmbedding();
  expect(
    capn([
      "chart",
      "Where is empty-details-keyword?",
      "--files",
      "src/empty.ts",
    ]).exitCode
  ).toBe(0);

  const asked = capn(["ask", "empty-details-keyword"]);

  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  const hit = parseJSONLines(asked.stdout.toString())[0];
  expect(hit).toEqual({
    id: entryId("Where is empty-details-keyword?"),
    question: "Where is empty-details-keyword?",
    files: ["src/empty.ts"],
    score: expect.any(Number),
  });
  expect("details" in hit).toBe(false);
});

test("ask prunes stale entries before recall and prints the miss contract", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 1\n");
  initNoEmbedding();
  expect(
    capn(["chart", "Where is stale?", "--files", "src/stale.ts"]).exitCode
  ).toBe(0);
  const id = entryId("Where is stale?");
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 2\n");

  const asked = capn(["ask", "Where is stale?"]);

  expect(asked.exitCode).toBe(1);
  expect(asked.stdout.toString()).toBe("");
  expect(asked.stderr.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn chart "Where is stale?" --files <files> [--details "<extra context>"]\n'
  );
  expect(existsSync(join(workDir, ".capn/entries", `${id}.md`))).toBe(false);
});

test("ask with no hits prints the no-charted-answer contract", () => {
  initNoEmbedding();

  const asked = capn(["ask", "where is the compass?"]);

  expect(asked.exitCode).toBe(1);
  expect(asked.stdout.toString()).toBe("");
  expect(asked.stderr.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn chart "where is the compass?" --files <files> [--details "<extra context>"]\n'
  );
});

test("bust removes entries that cite a file", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  writeFileSync(join(workDir, "src/b.ts"), "b\n");
  expect(capn(["chart", "Where is A?", "--files", "src/a.ts"]).exitCode).toBe(
    0
  );
  expect(capn(["chart", "Where is B?", "--files", "src/b.ts"]).exitCode).toBe(
    0
  );

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
  expect(capn(["chart", "Where is A?", "--files", "src/a.ts"]).exitCode).toBe(
    0
  );
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
  expect(capn(["chart", "Where is A?", "--files", "src/a.ts"]).exitCode).toBe(
    0
  );

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
    capn([
      "chart",
      "Where is A?",
      "--files",
      "src/a.ts",
      "--details",
      "Line 1 has the answer.",
    ]).exitCode
  ).toBe(0);
  writeFileSync(join(workDir, ".capn/map.json"), "{}");

  const listed = capn(["list"]);

  expect(listed.exitCode).toBe(0);
  expect(listed.stdout.toString()).toContain(entryId("Where is A?"));
  expect(listed.stdout.toString()).toContain("Q: Where is A?");
  expect(listed.stdout.toString()).not.toContain("A:");
  expect(listed.stdout.toString()).toContain(
    "Details:\nLine 1 has the answer."
  );
  expect(listed.stdout.toString()).toContain("  - src/a.ts");
});

test("context prints the exact static contract", () => {
  mkdirSync(join(workDir, ".capn"));
  const result = capn(["context"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(contextContract);
});

test("context does not leak stored content or prune", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(
    join(workDir, "src/context.ts"),
    "export const contextSentinel = 1\n"
  );
  expect(
    capn([
      "chart",
      "Where is context sentinel?",
      "--files",
      "src/context.ts",
      "--details",
      "chart-context-sentinel lives in src/context.ts",
    ]).exitCode
  ).toBe(0);
  const id = entryId("Where is context sentinel?");
  writeFileSync(
    join(workDir, ".capn/private.md"),
    "private-context-sentinel\n"
  );
  writeFileSync(
    join(workDir, "src/context.ts"),
    "export const contextSentinel = 2\n"
  );

  const result = capn(["context"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).not.toContain("chart-context-sentinel");
  expect(result.stdout.toString()).not.toContain("private-context-sentinel");
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
  expect(first.stdout.toString()).toContain("qmd capn collection");

  expect(readJSON(join(workDir, ".capn/config.json"))).toEqual({
    embedding: false,
  });
  expect(existsSync(join(workDir, ".capn/journal"))).toBe(false);
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

  const claudeSettings = readJSON(join(workDir, ".claude/settings.json"));
  const settings = readJSON(join(workDir, ".claude/settings.local.json"));
  const codexHooks = readJSON(join(workDir, ".codex/hooks.json"));
  const sessionCommands = claudeSettings.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const sessionHooks = claudeSettings.hooks.SessionStart.flatMap(
    (group: { hooks: { args?: string[]; command: string }[] }) => group.hooks
  );
  const stopCommands = settings.hooks.Stop.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  expect(
    sessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command && hook.args === undefined
    )
  ).toHaveLength(1);
  expect(sessionCommands).not.toContain("capn context");
  expect(
    stopCommands.filter((command: string) => command.includes("capn "))
  ).toHaveLength(0);
  expect(stopCommands).toContain("echo old");
  expect(claudeSettings.model).toBe("sonnet");
  expect(settings.model).toBeUndefined();
  expect(settings.hooks.SessionStart).toBeUndefined();
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
        hook.command === contextHook.command && hook.args === undefined
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
  const capnShim = join(binDir, "capn");
  writeFileSync(
    capnShim,
    `#!/usr/bin/env sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(capnPath)} "$@"\n`
  );
  chmodSync(capnShim, 0o755);

  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  expect(
    capn([
      "chart",
      "Where is X?",
      "--files",
      "src/a.ts",
      "--details",
      "In src/a.ts",
    ]).exitCode
  ).toBe(0);
  const asked = capn(["ask", "Where is X?"]);
  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(parseJSONLines(asked.stdout.toString())[0]).toMatchObject({
    details: "In src/a.ts",
    files: ["src/a.ts"],
  });
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
    join(workDir, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "capn context" }] },
        ],
        Stop: [oldNudgeGroup, unrelatedStopGroup],
      },
    })
  );
  writeFileSync(
    join(workDir, ".claude/settings.local.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", ...splitContextHook }] }],
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
          { hooks: [{ type: "command", ...splitContextHook }] },
        ],
        Stop: [oldNudgeGroup, unrelatedStopGroup],
      },
    })
  );

  initNoEmbedding();
  initNoEmbedding();

  const claudeSettings = readJSON(join(workDir, ".claude/settings.json"));
  const settings = readJSON(join(workDir, ".claude/settings.local.json"));
  const codexHooks = readJSON(join(workDir, ".codex/hooks.json"));
  const sessionCommands = claudeSettings.hooks.SessionStart.flatMap(
    (group: { hooks: { command: string }[] }) =>
      group.hooks.map((hook) => hook.command)
  );
  const sessionHooks = claudeSettings.hooks.SessionStart.flatMap(
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
        hook.command === contextHook.command && hook.args === undefined
    )
  ).toHaveLength(1);
  expect(sessionCommands).not.toContain("capn context");
  expect(sessionCommands).not.toContain(splitContextHook.command);
  expect(
    codexSessionHooks.filter(
      (hook: { args?: string[]; command: string }) =>
        hook.command === contextHook.command && hook.args === undefined
    )
  ).toHaveLength(1);
  expect(codexSessionCommands).not.toContain("capn context");
  expect(codexSessionCommands).not.toContain(splitContextHook.command);
  expect(settings.hooks.SessionStart).toBeUndefined();
  expect(claudeSettings.hooks.Stop).toHaveLength(1);
  expect(settings.hooks.Stop).toHaveLength(1);
  expect(codexHooks.hooks.Stop).toHaveLength(1);
  expect(JSON.stringify(claudeSettings.hooks.Stop[0])).toBe(
    unrelatedStopGroupJSON
  );
  expect(JSON.stringify(settings.hooks.Stop[0])).toBe(unrelatedStopGroupJSON);
  expect(JSON.stringify(codexHooks.hooks.Stop[0])).toBe(unrelatedStopGroupJSON);
  expect(JSON.stringify(claudeSettings)).not.toContain("capn nudge");
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
      "--files",
      "src/capn.ts",
      "--details",
      "capn-sdk-keyword lives in src/capn.ts.",
    ]).exitCode
  ).toBe(0);
  const asked = capn(["ask", "capn-sdk-keyword"]);
  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(parseJSONLines(asked.stdout.toString())[0]).toMatchObject({
    details: "capn-sdk-keyword lives in src/capn.ts.",
    files: ["src/capn.ts"],
  });
  expect(asked.stdout.toString()).not.toContain("host-lighthouse-keyword");

  expect(readFileSync(hostIndexPath)).toEqual(hostIndex);
  const hostCollections = qmd(["collection", "list"]);
  expect(hostCollections.exitCode, hostCollections.stderr.toString()).toBe(0);
  expect(hostCollections.stdout.toString()).toContain("hostdocs");
  expect(hostCollections.stdout.toString()).not.toContain("capn");
  expect(hostCollections.stdout.toString()).not.toContain("journal");

  const hostAskedByCapn = capn(["ask", "host-lighthouse-keyword"]);
  expect(hostAskedByCapn.exitCode).toBe(1);
  expect(hostAskedByCapn.stdout.toString()).toBe("");
  expect(hostAskedByCapn.stderr.toString()).toContain("No charted answer.");
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
