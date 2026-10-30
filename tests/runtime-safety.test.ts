import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

const completeRecordPattern =
  /^[0-9a-f]{16}\nQ: Where is the answer\?\nFiles:\n {2}- [^\n]+\/answer\.ts\nDetails:\n(version [0-4]: [0-4]+)\n$/;

const capnPath = resolve(import.meta.dir, "../src/run.ts");

function workspace() {
  const workDir = realpathSync(
    mkdtempSync(join(tmpdir(), "capn-runtime-test-"))
  );
  writeFileSync(join(workDir, "answer.ts"), "export const answer = 42;\n");

  function capn(args: string[]) {
    return execa(process.execPath, [capnPath, ...args], {
      cwd: workDir,
      env: {
        ...process.env,
        HOME: join(workDir, ".home"),
        PWD: workDir,
        XDG_CACHE_HOME: join(workDir, ".cache"),
        XDG_CONFIG_HOME: join(workDir, ".config"),
      },
      reject: false,
      stripFinalNewline: false,
    });
  }

  return {
    workDir,
    capn,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

test.concurrent("unchart rejects path-shaped IDs without deleting files", async () => {
  const { workDir, capn, cleanup } = workspace();
  try {
    const charted = await capn([
      "chart",
      "Where is the answer?",
      "--files",
      "answer.ts",
    ]);
    expect(charted.exitCode, charted.stderr).toBe(0);
    const id = charted.stdout.trim().slice("charted ".length);
    const configPath = join(workDir, ".home/.capn/config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const name = Object.keys(config.workspaces)[0];
    if (!name) {
      throw new Error("expected a central workspace");
    }
    const entryPath = join(
      workDir,
      ".home/.capn/workspaces",
      name,
      "entries",
      `${id}.md`
    );
    const originalEntry = readFileSync(entryPath, "utf8");
    const originalConfig = readFileSync(configPath, "utf8");
    const sentinels = [
      {
        id: "../../victim",
        path: resolve(dirname(entryPath), "../../victim.md"),
      },
      {
        id: join(workDir, "absolute-victim"),
        path: join(workDir, "absolute-victim.md"),
      },
    ];
    for (const sentinel of sentinels) {
      writeFileSync(sentinel.path, "keep this file\n");
      const result = await capn(["unchart", sentinel.id]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid id");
      expect(readFileSync(sentinel.path, "utf8")).toBe("keep this file\n");
      expect(readFileSync(entryPath, "utf8")).toBe(originalEntry);
      expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
    }

    const unknown = await capn(["unchart", "ffffffffffffffff"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown id: ffffffffffffffff");
    expect(existsSync(entryPath)).toBe(true);

    const deleted = await capn(["unchart", id]);
    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(existsSync(entryPath)).toBe(false);
  } finally {
    cleanup();
  }
});

test.concurrent("parallel chart and list expose complete immutable discovery versions", async () => {
  const { workDir, capn, cleanup } = workspace();
  try {
    const question = "Where is the answer?";
    const details = Array.from(
      { length: 5 },
      (_, index) => `version ${index}: ${String(index).repeat(32_768)}`
    );
    const seed = await capn([
      "chart",
      question,
      "--files",
      "answer.ts",
      "--details",
      details[0],
    ]);
    expect(seed.exitCode, seed.stderr).toBe(0);
    const config = JSON.parse(
      readFileSync(join(workDir, ".home/.capn/config.json"), "utf8")
    );
    const registered = Object.values(config.workspaces)[0] as {
      repos: Record<string, unknown>;
    };
    const alias = Object.keys(registered.repos)[0];
    const failures: string[] = [];

    const writers = details.slice(1).map(async (detail) => {
      for (let iteration = 0; iteration < 12; iteration++) {
        const result = await capn([
          "chart",
          question,
          "--files",
          "answer.ts",
          "--details",
          detail,
        ]);
        if (result.exitCode !== 0) {
          failures.push(`chart failed: ${result.stderr}`);
        }
      }
    });
    const readers = Array.from({ length: 6 }, async () => {
      for (let iteration = 0; iteration < 24; iteration++) {
        const result = await capn(["list"]);
        if (result.exitCode === 0) {
          const records = result.stdout.trimEnd().split("\n\n");
          if (records.length === 0 || records.length > details.length) {
            failures.push(`list returned ${records.length} records`);
          }
          for (const record of records) {
            const match = completeRecordPattern.exec(`${record.trimStart()}\n`);
            if (
              !(
                match &&
                details.includes(match[1] ?? "") &&
                record.includes(`  - ${alias}/answer.ts`)
              )
            ) {
              failures.push(
                `list returned an incomplete record (${record.length} bytes)`
              );
            }
          }
        } else {
          failures.push(`list failed: ${result.stderr}`);
        }
      }
    });
    await Promise.all([...writers, ...readers]);
    expect(failures).toEqual([]);
    const final = await capn(["list"]);
    expect(final.exitCode, final.stderr).toBe(0);
    expect(final.stdout.trimEnd().split("\n\n")).toHaveLength(details.length);
  } finally {
    cleanup();
  }
}, 15_000);
