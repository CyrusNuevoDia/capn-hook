import { test as bunTest, expect } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

const test = bunTest.concurrent;
const CLIPath = resolve(import.meta.dir, "../src/run.ts");
const proofPath = resolve(import.meta.dir, "agent-e2e-capn.ts");
const chartPrefixPattern = /^charted /;
const loginShell = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";

async function workspace(
  run: (tools: Awaited<ReturnType<typeof setup>>) => Promise<void>
) {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), "capn-e2e-proof-")));
  try {
    await run(await setup(workDir));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function setup(workDir: string) {
  const events = join(workDir, "events.jsonl");
  const feesFile = join(workDir, "fees.ts");
  const bin = join(workDir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "capn"),
    '#!/bin/sh\nexec "$CAPN_E2E_BUN" "$CAPN_E2E_CLI" "$@"\n',
    { mode: 0o755 }
  );
  const {
    XDG_CACHE_HOME: _cache,
    XDG_CONFIG_HOME: _config,
    ...baseEnv
  } = process.env;
  const env = {
    ...baseEnv,
    HOME: join(workDir, "home"),
    PWD: workDir,
    PATH: `${bin}:${process.env.PATH}`,
    CAPN_E2E_BUN: process.execPath,
    CAPN_E2E_CLI: CLIPath,
  };
  function invoke(command: string, args: string[]) {
    return execa(command, args, {
      cwd: workDir,
      env,
      reject: false,
      stripFinalNewline: false,
      all: true,
    });
  }
  const capn = (args: string[]) => invoke(process.execPath, [CLIPath, ...args]);
  const verify = (entryId: string, file = feesFile) =>
    invoke(process.execPath, [proofPath, events, entryId, file]);

  // These are adapter unit fixtures, not receipts proving a Codex agent acted.
  // The paid E2E supplies the event envelope; this helper supplies real CLI IO.
  async function commandEvent(command: string) {
    const result = await invoke(loginShell, ["-lc", command]);
    return {
      type: "item.completed",
      item: {
        id: "command-fixture",
        type: "command_execution",
        command: result.escapedCommand,
        status: result.exitCode === 0 ? "completed" : "failed",
        aggregated_output: result.all,
        exit_code: result.exitCode,
      },
    };
  }
  function save(...values: unknown[]) {
    writeFileSync(
      events,
      `${values.map((value) => JSON.stringify(value)).join("\n")}\n`
    );
  }

  writeFileSync(feesFile, "export const mooringFee = 3;\n");
  writeFileSync(join(workDir, "cargo.ts"), "export const quasarCargo = 7;\n");
  const init = await capn(["init", "--no-embedding"]);
  expect(init.exitCode, init.stderr).toBe(0);
  const chart = await capn([
    "chart",
    "Where are mooring fees calculated?",
    "--files",
    "fees.ts",
  ]);
  expect(chart.exitCode, chart.stderr).toBe(0);
  const entryId = chart.stdout.trim().replace(chartPrefixPattern, "");
  const unrelated = await capn([
    "chart",
    "Where is quasar cargo handled?",
    "--files",
    "cargo.ts",
  ]);
  expect(unrelated.exitCode, unrelated.stderr).toBe(0);
  const unrelatedId = unrelated.stdout.trim().replace(chartPrefixPattern, "");
  return { capn, commandEvent, save, verify, entryId, unrelatedId, feesFile };
}

test("command-event adapter accepts a login-shell ask with actual CLI JSONL", async () => {
  await workspace(async ({ commandEvent, save, verify, entryId }) => {
    const unrelated = await commandEvent('capn ask "quasar"');
    const recalled = await commandEvent('capn ask "mooring"');
    expect(recalled.item.exit_code).toBe(0);
    expect(recalled.item.aggregated_output).toContain(entryId);
    save(unrelated, recalled);
    const proof = await verify(entryId);
    expect(proof.exitCode, proof.stderr).toBe(0);
  });
});

test("command-event adapter rejects answer claims, list output, and quoted ask text", async () => {
  await workspace(async ({ capn, commandEvent, save, verify, entryId }) => {
    const hit = await capn(["ask", "mooring"]);
    const listed = await commandEvent("capn list");
    expect(listed.item.exit_code).toBe(0);
    const echoed = await commandEvent("echo 'capn ask mooring'");
    save(
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `capn ask mooring\n${hit.stdout}`,
        },
      },
      listed,
      { ...echoed, item: { ...echoed.item, aggregated_output: hit.stdout } }
    );
    const proof = await verify(entryId);
    expect(proof.exitCode).toBe(1);
    expect(proof.stderr).toContain("No successful capn ask returned chart");
  });
});

test("command-event adapter rejects a real ask miss and a nonzero completed event", async () => {
  await workspace(async ({ commandEvent, save, verify, entryId }) => {
    const missed = await commandEvent("capn ask xylophonicallyunfindable");
    expect(missed.item.exit_code).toBe(1);
    expect(missed.item.aggregated_output).toContain("No charted answer");
    save(missed);
    expect((await verify(entryId)).exitCode).toBe(1);
    const hit = await commandEvent("capn ask mooring");
    save({ ...hit, item: { ...hit.item, status: "completed", exit_code: 1 } });
    expect((await verify(entryId)).exitCode).toBe(1);
  });
});

test("command-event adapter rejects unrelated charts and incorrect backing files", async () => {
  await workspace(
    async ({ commandEvent, save, verify, entryId, unrelatedId }) => {
      const unrelated = await commandEvent("capn ask quasar");
      expect(unrelated.item.exit_code).toBe(0);
      save(unrelated);
      expect((await verify(entryId)).exitCode).toBe(1);
      expect((await verify(unrelatedId)).exitCode).toBe(1);
    }
  );
});
