import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const capnPath = resolve(import.meta.dir, "../src/capn.ts");

const contextContract = `<capn-hook>
This project keeps a chart of past discoveries: questions earlier sessions answered, and the files that back each answer.

Thinking about finding something? Ask the capn first:

    capn ask "where are payment webhooks handled?"

A hit hands you the answer and the exact files, skipping the whole search. A miss costs seconds; re-exploring costs minutes.

When you do discover a route the hard way (real exploration, more than a couple of tool calls), chart it for the next session:

    capn add "<question>" "<answer with file paths>" --files <comma-separated files backing it>

Entries whose backing files change are deleted automatically, so when the capn answers, the answer is current. Re-add a question to replace its entry; never edit entry files by hand.
</capn-hook>
`;

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "capn-test-"));
});

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function capn(args: string[] = [], input = "", cwd = workDir) {
  return Bun.spawnSync({
    cmd: [capnPath, ...args],
    cwd,
    env: qmdEnv(cwd),
    stdin: input ? Buffer.from(input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function qmdEnv(cwd = workDir, env: Record<string, string> = {}) {
  const { XDG_CACHE_HOME: _cache, XDG_CONFIG_HOME: _config, ...base } = process.env;
  return {
    ...base,
    HOME: join(workDir, ".home"),
    PWD: cwd,
    ...env,
  };
}

function run(cmd: string[], cwd = workDir, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: qmdEnv(cwd, env),
  });
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

function initNoEmbedding() {
  const result = capn(["init", "--no-embedding"]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

test("prints updated usage for help and rejects missing commands", () => {
  mkdirSync(join(workDir, ".capn"));

  const help = capn(["--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("capn ask");
  expect(help.stdout.toString()).toContain("capn init [--git] [--embedding|--no-embedding]");

  const missing = capn();
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout.toString()).toContain("Usage:");
});

test("add writes QMD markdown entry and derived map", () => {
  mkdirSync(join(workDir, "src/harbor"), { recursive: true });
  const source = "export function mooringFee() { return 1 }\n";
  writeFileSync(join(workDir, "src/harbor/fees.ts"), source);

  const added = capn([
    "add",
    "Where are mooring fees calculated?",
    "mooringFee() in src/harbor/fees.ts; invoiced from src/harbor/registry.ts.",
    "--files",
    "src/harbor/fees.ts",
  ]);
  const id = entryId("Where are mooring fees calculated?");

  expect(added.exitCode).toBe(0);
  expect(added.stdout.toString()).toBe(`charted ${id}\n`);
  expect(added.stderr.toString()).toContain("capn init");

  const entry = readFileSync(join(workDir, ".capn/entries", `${id}.md`), "utf8");
  expect(entry).toContain("---\ncapn: 1\n");
  expect(entry).toContain(`id: ${id}\n`);
  expect(entry).toMatch(/at: \d{4}-\d{2}-\d{2}T/);
  expect(entry).toContain(`files:\n  src/harbor/fees.ts: ${sha256(source)}\n---\n\n`);
  expect(entry).toContain("# Where are mooring fees calculated?\n\n");
  expect(entry).toEndWith("mooringFee() in src/harbor/fees.ts; invoiced from src/harbor/registry.ts.\n");

  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/harbor/fees.ts": {
      hash: sha256(source),
      entries: [id],
    },
  });
});

test("add refuses missing files without writing storage", () => {
  const added = capn(["add", "Where is the anchor?", "src/anchor.ts", "--files", "src/anchor.ts"]);

  expect(added.exitCode).toBe(1);
  expect(added.stderr.toString()).toContain("missing or not a regular file: src/anchor.ts");
  expect(existsSync(join(workDir, ".capn"))).toBe(false);
});

test("re-adding the same question replaces the entry and map rows", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const a = 1\n");
  writeFileSync(join(workDir, "src/b.ts"), "export const b = 2\n");

  expect(capn(["add", "Where is X?", "First answer", "--files", "src/a.ts"]).exitCode).toBe(0);
  expect(capn(["add", "Where is X?", "Second answer", "--files", "src/b.ts"]).exitCode).toBe(0);

  const entries = readdirSync(join(workDir, ".capn/entries"));
  const id = entryId("Where is X?");
  expect(entries).toEqual([`${id}.md`]);
  expect(readFileSync(join(workDir, ".capn/entries", `${id}.md`), "utf8")).toContain("Second answer\n");
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({
    "src/b.ts": {
      hash: sha256("export const b = 2\n"),
      entries: [id],
    },
  });
});

test("add from a subdirectory stores root-relative POSIX file paths", () => {
  expect(run(["git", "init", "-q"]).exitCode).toBe(0);
  mkdirSync(join(workDir, "src/deep"), { recursive: true });
  writeFileSync(join(workDir, "src/deep/a.ts"), "export const a = 1\n");

  const added = capn(["add", "Where is deep A?", "src/deep/a.ts", "--files", "a.ts"], "", join(workDir, "src/deep"));

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
  writeFileSync(join(workDir, "src/payments.ts"), "export const webhook = true\n");
  initNoEmbedding();
  expect(
    capn(["add", "Where are payment webhooks handled?", "They are handled in src/payments.ts.", "--files", "src/payments.ts"])
      .exitCode,
  ).toBe(0);

  const asked = capn(["ask", "payment webhooks"]);

  expect(asked.exitCode, asked.stderr.toString()).toBe(0);
  expect(asked.stdout.toString()).toContain("Where are payment webhooks handled?");
  expect(asked.stdout.toString()).toContain("They are handled in src/payments.ts.");
  expect(asked.stdout.toString()).toContain("files: src/payments.ts");
  expect(asked.stdout.toString()).toMatch(/score: \d+%/);
});

test("ask prunes stale entries before recall and prints the miss contract", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 1\n");
  initNoEmbedding();
  expect(capn(["add", "Where is stale?", "In src/stale.ts", "--files", "src/stale.ts"]).exitCode).toBe(0);
  const id = entryId("Where is stale?");
  writeFileSync(join(workDir, "src/stale.ts"), "export const stale = 2\n");

  const asked = capn(["ask", "Where is stale?"]);

  expect(asked.exitCode).toBe(0);
  expect(asked.stdout.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn add "Where is stale?" "<answer with paths>" --files <files>\n',
  );
  expect(existsSync(join(workDir, ".capn/entries", `${id}.md`))).toBe(false);
});

test("ask with no hits prints the no-charted-answer contract", () => {
  initNoEmbedding();

  const asked = capn(["ask", "where is the compass?"]);

  expect(asked.exitCode).toBe(0);
  expect(asked.stdout.toString()).toBe(
    'No charted answer. Explore, then chart what you find:\n  capn add "where is the compass?" "<answer with paths>" --files <files>\n',
  );
});

test("bust removes entries that cite a file", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  writeFileSync(join(workDir, "src/b.ts"), "b\n");
  expect(capn(["add", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
  expect(capn(["add", "Where is B?", "src/b.ts", "--files", "src/b.ts"]).exitCode).toBe(0);

  const busted = capn(["bust", "src/a.ts"]);

  expect(busted.exitCode).toBe(0);
  expect(busted.stdout.toString()).toBe("busted 1 entries\n");
  expect(existsSync(join(workDir, ".capn/entries", `${entryId("Where is A?")}.md`))).toBe(false);
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
  expect(capn(["add", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
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
  expect(readJSON(join(workDir, ".capn/map.json"))["src/a.ts"].entries).toEqual([entryId("Where is A?")]);

  writeFileSync(join(workDir, "src/a.ts"), "changed\n");
  const stale = capn(["prune"]);
  expect(stale.exitCode).toBe(0);
  expect(stale.stdout.toString()).toBe("pruned 1 stale entries\n");
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
});

test("delete removes an entry by id and rejects unknown ids", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  expect(capn(["add", "Where is A?", "src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);

  const unknown = capn(["delete", "ffffffff"]);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr.toString()).toContain("unknown id: ffffffff");

  const deleted = capn(["delete", entryId("Where is A?")]);
  expect(deleted.exitCode).toBe(0);
  expect(existsSync(join(workDir, ".capn/entries", `${entryId("Where is A?")}.md`))).toBe(false);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
});

test("list prints entries straight from markdown files", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "a\n");
  expect(capn(["add", "Where is A?", "Answer in src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
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

test("nudge blocks once per session unless a stop hook is already active", () => {
  const sessionId = randomUUID();
  const input = JSON.stringify({ session_id: sessionId, stop_hook_active: false });

  const first = capn(["nudge"], input);
  expect(first.exitCode).toBe(0);
  const firstJSON = JSON.parse(first.stdout.toString());
  expect(firstJSON.decision).toBe("block");
  expect(firstJSON.reason).toBe(
    'Capn\'s log before you go: did this session discover any routes worth charting - where things live, how something works? Chart each with: capn add "<question>" "<answer with file paths>" --files <files>. If nothing is worth keeping, just stop again.',
  );

  const second = capn(["nudge"], input);
  expect(second.exitCode).toBe(0);
  expect(second.stdout.toString()).toBe("");

  const active = capn(["nudge"], JSON.stringify({ session_id: randomUUID(), stop_hook_active: true }));
  expect(active.exitCode).toBe(0);
  expect(active.stdout.toString()).toBe("");
});

test("init is idempotent and installs QMD, Claude hooks, gitignore, config, and post-commit pruning", () => {
  expect(run(["git", "init", "-q"]).exitCode).toBe(0);
  expect(run(["git", "config", "user.email", "t@t.co"]).exitCode).toBe(0);
  expect(run(["git", "config", "user.name", "t"]).exitCode).toBe(0);

  mkdirSync(join(workDir, ".claude"), { recursive: true });
  writeFileSync(
    join(workDir, ".claude/settings.json"),
    JSON.stringify({
      model: "sonnet",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo old" }] }],
      },
    }),
  );

  const first = capn(["init", "--git", "--no-embedding"]);
  expect(first.exitCode, first.stderr.toString()).toBe(0);
  const second = capn(["init", "--git", "--no-embedding"]);
  expect(second.exitCode, second.stderr.toString()).toBe(0);

  expect(readJSON(join(workDir, ".capn/config.json"))).toEqual({ embedding: false });
  expect(existsSync(join(workDir, ".qmd/index.yml"))).toBe(true);
  expect(existsSync(join(workDir, ".qmd/index.sqlite"))).toBe(true);
  expect(readFileSync(join(workDir, ".gitignore"), "utf8").split("\n").filter((line) => line === ".qmd/")).toHaveLength(1);

  const settings = readJSON(join(workDir, ".claude/settings.json"));
  expect(settings.model).toBe("sonnet");
  const sessionCommands = settings.hooks.SessionStart.flatMap((group: { hooks: { command: string }[] }) =>
    group.hooks.map((hook) => hook.command),
  );
  const stopCommands = settings.hooks.Stop.flatMap((group: { hooks: { command: string }[] }) =>
    group.hooks.map((hook) => hook.command),
  );
  expect(sessionCommands.filter((command: string) => command === "capn context")).toHaveLength(1);
  expect(stopCommands.filter((command: string) => command === "capn nudge")).toHaveLength(1);
  expect(stopCommands).toContain("echo old");

  const postCommit = readFileSync(join(workDir, ".git/hooks/post-commit"), "utf8");
  expect(postCommit).toContain("capn prune");

  const binDir = join(workDir, "bin");
  mkdirSync(binDir);
  symlinkSync(capnPath, join(binDir, "capn"));

  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  expect(capn(["add", "Where is X?", "In src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 2\n");

  expect(run(["git", "add", "-A"], workDir, { PATH: `${binDir}:${process.env.PATH ?? ""}` }).exitCode).toBe(0);
  const commit = run(["git", "commit", "-m", "x"], workDir, { PATH: `${binDir}:${process.env.PATH ?? ""}` });
  expect(commit.exitCode, commit.stderr.toString()).toBe(0);
  expect(readJSON(join(workDir, ".capn/map.json"))).toEqual({});
  expect(existsSync(join(workDir, ".capn/entries", `${entryId("Where is X?")}.md`))).toBe(false);
});
