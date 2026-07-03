import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const captainPath = resolve(import.meta.dir, "../src/captain.ts");

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "captain-test-"));
});

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function captain(args: string[] = [], input = "") {
  return Bun.spawnSync({
    cmd: [captainPath, ...args],
    cwd: workDir,
    stdin: input ? Buffer.from(input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function run(cmd: string[], cwd = workDir, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
}

test("prints usage for help and rejects missing commands", () => {
  mkdirSync(join(workDir, ".captain"));

  const help = captain(["--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("captain add");

  const missing = captain();
  expect(missing.exitCode).toBe(1);
  expect(missing.stdout.toString()).toContain("Usage:");
});

test("add stores hashed relative files and replaces the same question", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  const source = "export const x = 1\n";
  writeFileSync(join(workDir, "src/a.ts"), source);

  const added = captain(["add", "Where is X?", "In src/a.ts", "--files", "src/a.ts"]);
  expect(added.exitCode).toBe(0);
  expect(added.stdout.toString()).toContain("charted");

  const replaced = captain(["add", "Where is X?", "Now in src/a.ts", "--files", "src/a.ts"]);
  expect(replaced.exitCode).toBe(0);

  const lines = readFileSync(join(workDir, ".captain/map.jsonl"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);

  const entry = JSON.parse(lines[0]);
  expect(entry.id).toMatch(/^[0-9a-f]{8}$/);
  expect(entry.q).toBe("Where is X?");
  expect(entry.a).toBe("Now in src/a.ts");
  expect(entry.files).toEqual([
    {
      path: "src/a.ts",
      hash: createHash("sha256").update(source).digest("hex"),
    },
  ]);
  expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("prune removes stale file entries and delete removes a selected entry", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  writeFileSync(join(workDir, "src/b.ts"), "export const y = 2\n");

  expect(captain(["add", "Where is X?", "In src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
  expect(captain(["add", "Where is Y?", "In src/b.ts", "--files", "src/b.ts"]).exitCode).toBe(0);

  const freshPrune = captain(["prune"]);
  expect(freshPrune.exitCode).toBe(0);
  expect(freshPrune.stdout.toString()).toBe("");
  expect(readFileSync(join(workDir, ".captain/map.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);

  writeFileSync(join(workDir, "src/a.ts"), "export const x = 99\n");
  const stalePrune = captain(["prune"]);
  expect(stalePrune.exitCode).toBe(0);
  expect(stalePrune.stdout.toString()).toContain("pruned 1 stale entries");

  let entries = readFileSync(join(workDir, ".captain/map.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(entries).toHaveLength(1);
  expect(entries[0].q).toBe("Where is Y?");

  const deleted = captain(["delete", entries[0].id]);
  expect(deleted.exitCode).toBe(0);
  expect(readFileSync(join(workDir, ".captain/map.jsonl"), "utf8")).toBe("");
});

test("list and context recall entries, and context prunes before printing its contract", () => {
  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  expect(captain(["add", "Where is X?", "In src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);

  const listed = captain(["list"]);
  expect(listed.exitCode).toBe(0);
  const listOut = listed.stdout.toString();
  expect(listOut).toContain("Where is X?");
  expect(listOut).toContain("In src/a.ts");
  expect(listOut).toContain("src/a.ts");
  expect(listOut).toMatch(/[0-9a-f]{8}/);

  const context = captain(["context"]);
  expect(context.exitCode).toBe(0);
  const contextOut = context.stdout.toString();
  expect(contextOut).toContain("Where is X?");
  expect(contextOut).toContain("In src/a.ts");
  expect(contextOut).toContain('captain add "<question>" "<answer with paths>" --files <files>');

  writeFileSync(join(workDir, "src/a.ts"), "export const x = 2\n");
  const prunedContext = captain(["context"]);
  expect(prunedContext.exitCode).toBe(0);
  const prunedOut = prunedContext.stdout.toString();
  expect(prunedOut).not.toContain("Where is X?");
  expect(prunedOut).toContain("captain add");

  rmSync(join(workDir, ".captain"), { recursive: true, force: true });
  const emptyContext = captain(["context"]);
  expect(emptyContext.exitCode).toBe(0);
  expect(emptyContext.stdout.toString()).toContain("captain add");
});

test("nudge blocks once per session unless a stop hook is already active", () => {
  const sessionId = randomUUID();
  const input = JSON.stringify({ session_id: sessionId, stop_hook_active: false });

  const first = captain(["nudge"], input);
  expect(first.exitCode).toBe(0);
  const firstJSON = JSON.parse(first.stdout.toString());
  expect(firstJSON.decision).toBe("block");
  expect(firstJSON.reason).toContain("captain add");

  const second = captain(["nudge"], input);
  expect(second.exitCode).toBe(0);
  expect(second.stdout.toString()).toBe("");

  const active = captain(["nudge"], JSON.stringify({ session_id: randomUUID(), stop_hook_active: true }));
  expect(active.exitCode).toBe(0);
  expect(active.stdout.toString()).toBe("");
});

test("init merges Claude hooks idempotently and git post-commit prunes stale entries", () => {
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

  const first = captain(["init", "--git"]);
  expect(first.exitCode).toBe(0);
  const second = captain(["init", "--git"]);
  expect(second.exitCode).toBe(0);

  const settings = JSON.parse(readFileSync(join(workDir, ".claude/settings.json"), "utf8"));
  expect(settings.model).toBe("sonnet");
  const sessionCommands = settings.hooks.SessionStart.flatMap((group: { hooks: { command: string }[] }) =>
    group.hooks.map((hook) => hook.command),
  );
  const stopCommands = settings.hooks.Stop.flatMap((group: { hooks: { command: string }[] }) =>
    group.hooks.map((hook) => hook.command),
  );
  expect(sessionCommands.filter((command: string) => command === "captain context")).toHaveLength(1);
  expect(stopCommands.filter((command: string) => command === "captain nudge")).toHaveLength(1);
  expect(stopCommands).toContain("echo old");

  const postCommit = readFileSync(join(workDir, ".git/hooks/post-commit"), "utf8");
  expect(postCommit).toContain("captain prune");

  const binDir = join(workDir, "bin");
  mkdirSync(binDir);
  symlinkSync(captainPath, join(binDir, "captain"));

  mkdirSync(join(workDir, "src"), { recursive: true });
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 1\n");
  expect(captain(["add", "Where is X?", "In src/a.ts", "--files", "src/a.ts"]).exitCode).toBe(0);
  writeFileSync(join(workDir, "src/a.ts"), "export const x = 2\n");

  expect(run(["git", "add", "-A"], workDir, { PATH: `${binDir}:${process.env.PATH ?? ""}` }).exitCode).toBe(0);
  const commit = run(["git", "commit", "-m", "x"], workDir, { PATH: `${binDir}:${process.env.PATH ?? ""}` });
  expect(commit.exitCode).toBe(0);
  expect(readFileSync(join(workDir, ".captain/map.jsonl"), "utf8")).toBe("");
});
