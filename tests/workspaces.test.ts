import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

const CLI = resolve(import.meta.dir, "../src/run.ts");
const rejectedEvidencePattern = /outside workspace|unrelated/;
function workspace() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "capn-workspaces-")));
  const home = join(base, "home");
  const web = join(base, "scattered", "web");
  const API = join(base, "elsewhere", "api");
  mkdirSync(web, { recursive: true });
  mkdirSync(API, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const run = (args: string[], cwd = web) =>
    execa(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...env, PWD: cwd },
      reject: false,
    });
  const git = (args: string[], cwd = web) =>
    execa("git", args, { cwd, env: { ...env, PWD: cwd }, reject: false });
  return {
    base,
    home,
    web,
    API,
    run,
    git,
    env,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

test.concurrent("scattered repositories share joint discoveries without local storage or owner leaks", async () => {
  const w = workspace();
  try {
    writeFileSync(join(w.web, "checkout.ts"), "createOrder()\n");
    writeFileSync(join(w.API, "orders.ts"), "export const order=1\n");
    for (const [cwd, alias] of [
      [w.web, "web"],
      [w.API, "api"],
    ] as const) {
      const result = await w.run(
        ["init", "--workspace", "shop", "--repo", alias, "--no-embedding"],
        cwd
      );
      expect(result.exitCode, result.stderr).toBe(0);
    }
    const chart = await w.run([
      "chart",
      "Where does checkout create orders?",
      "--files",
      `checkout.ts,${join(w.API, "orders.ts")}`,
    ]);
    expect(chart.exitCode, chart.stderr).toBe(0);
    const hit = await w.run(["ask", "checkout orders"], w.API);
    expect(hit.exitCode, hit.stderr).toBe(0);
    expect(JSON.parse(hit.stdout)).toMatchObject({
      workspace: "shop",
      files: [join(w.API, "orders.ts"), join(w.web, "checkout.ts")].sort(),
    });
    expect(existsSync(join(w.web, ".capn"))).toBe(false);
    expect(existsSync(join(w.API, ".capn"))).toBe(false);
    const before = readFileSync(join(w.home, ".capn/config.json"), "utf8");
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "other",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(1);
    expect(readFileSync(join(w.home, ".capn/config.json"), "utf8")).toBe(
      before
    );
  } finally {
    w.cleanup();
  }
});

test.concurrent("worktree versions retain H1 and H2, deduplicate identical evidence and restore on revert", async () => {
  const w = workspace();
  try {
    expect((await w.git(["init", "-q"])).exitCode).toBe(0);
    await w.git(["config", "user.email", "test@example.com"]);
    await w.git(["config", "user.name", "Test"]);
    writeFileSync(join(w.web, "answer.ts"), "H1\n");
    await w.git(["add", "answer.ts"]);
    await w.git(["commit", "-qm", "seed"]);
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const args = [
      "chart",
      "Where is versioned answer?",
      "--files",
      "answer.ts",
    ];
    const first = await w.run(args);
    expect(first.exitCode, first.stderr).toBe(0);
    expect((await w.run(args)).stdout).toBe(first.stdout);
    const branch = join(w.base, "branch");
    expect(
      (await w.git(["worktree", "add", "-qb", "feature", branch])).exitCode
    ).toBe(0);
    const wrongCheckout = await w.run(
      [
        "chart",
        "Where is alternate evidence?",
        "--files",
        join(w.web, "answer.ts"),
      ],
      branch
    );
    expect(wrongCheckout.exitCode).toBe(1);
    expect(wrongCheckout.stderr).toContain("outside workspace");
    writeFileSync(join(branch, "answer.ts"), "H2\n");
    const second = await w.run(args, branch);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(second.stdout).not.toBe(first.stdout);
    const ask = async (cwd: string) => {
      const r = await w.run(["ask", "versioned answer"], cwd);
      expect(r.exitCode, r.stderr).toBe(0);
      return JSON.parse(r.stdout).id;
    };
    expect(await ask(w.web)).toBe(first.stdout.slice(8));
    expect(await ask(branch)).toBe(second.stdout.slice(8));
    writeFileSync(join(w.web, "answer.ts"), "H2\n");
    expect(await ask(w.web)).toBe(second.stdout.slice(8));
    writeFileSync(join(w.web, "answer.ts"), "H1\n");
    expect(await ask(w.web)).toBe(first.stdout.slice(8));
    expect(
      readdirSync(join(w.home, ".capn/workspaces/shop/entries"))
    ).toHaveLength(2);
  } finally {
    w.cleanup();
  }
}, 15_000);

test.concurrent("init help and invalid options leave all registration and hook files absent", async () => {
  const w = workspace();
  try {
    for (const [args, code] of [
      [["init", "--help"], 0],
      [["init", "--unknown"], 1],
      [["init", "unexpected"], 1],
      [["init", "--git", "--no-embedding"], 1],
      [["init", "--workspace", "../escape", "--no-embedding"], 1],
    ] as const) {
      const result = await w.run([...args]);
      expect(result.exitCode, result.stderr).toBe(code);
      expect(existsSync(join(w.home, ".capn/config.json"))).toBe(false);
      expect(existsSync(join(w.web, ".claude"))).toBe(false);
      expect(existsSync(join(w.web, ".codex"))).toBe(false);
      expect(existsSync(join(w.web, ".capn"))).toBe(false);
    }
  } finally {
    w.cleanup();
  }
});

test.concurrent("isolated equal-basename directories keep equal questions in separate workspaces", async () => {
  const w = workspace();
  try {
    const other = join(w.base, "unrelated", "web");
    mkdirSync(other, { recursive: true });
    for (const [cwd, text] of [
      [w.web, "first evidence"],
      [other, "second evidence"],
    ] as const) {
      writeFileSync(join(cwd, "answer.ts"), text);
      expect((await w.run(["init", "--no-embedding"], cwd)).exitCode).toBe(0);
      expect(
        (
          await w.run(
            [
              "chart",
              "Where is the isolated answer?",
              "--files",
              "answer.ts",
              "--details",
              text,
            ],
            cwd
          )
        ).exitCode
      ).toBe(0);
    }
    const first = await w.run(["ask", "isolated answer"]);
    const second = await w.run(["ask", "isolated answer"], other);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      details: "first evidence",
      files: [join(w.web, "answer.ts")],
    });
    expect(JSON.parse(second.stdout)).toMatchObject({
      details: "second evidence",
      files: [join(other, "answer.ts")],
    });
    expect(JSON.parse(first.stdout).workspace).not.toBe(
      JSON.parse(second.stdout).workspace
    );
  } finally {
    w.cleanup();
  }
});

test.concurrent("registered subdirectories inherit ownership while symlinks and nested unrelated Git roots cannot supply evidence", async () => {
  const w = workspace();
  try {
    mkdirSync(join(w.web, "src"));
    writeFileSync(join(w.web, "src", "answer.ts"), "answer\n");
    writeFileSync(join(w.API, "outside.ts"), "outside\n");
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const charted = await w.run(
      ["chart", "Where is nested evidence?", "--files", "answer.ts"],
      join(w.web, "src")
    );
    expect(charted.exitCode, charted.stderr).toBe(0);
    const asked = await w.run(["ask", "nested evidence"], join(w.web, "src"));
    expect(asked.exitCode, asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout)).toMatchObject({
      workspace: "shop",
      files: [join(w.web, "src", "answer.ts")],
    });
    symlinkSync(join(w.API, "outside.ts"), join(w.web, "escape.ts"));
    const nested = join(w.web, "vendor");
    mkdirSync(nested);
    expect((await w.git(["init", "-q"], nested)).exitCode).toBe(0);
    writeFileSync(join(nested, "foreign.ts"), "foreign\n");
    const registryBefore = readFileSync(
      join(w.home, ".capn/config.json"),
      "utf8"
    );
    for (const file of ["escape.ts", "vendor/foreign.ts"]) {
      const result = await w.run([
        "chart",
        "Where is forbidden evidence?",
        "--files",
        file,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(rejectedEvidencePattern);
      expect(readFileSync(join(w.home, ".capn/config.json"), "utf8")).toBe(
        registryBefore
      );
    }
    expect((await w.run(["list"])).stdout).not.toContain("forbidden evidence");
    const nestedInit = await w.run(["init", "--no-embedding"], nested);
    expect(nestedInit.exitCode, nestedInit.stderr).toBe(0);
    expect((await w.run(["ask", "nested evidence"], nested)).exitCode).toBe(1);
  } finally {
    w.cleanup();
  }
});

test.concurrent("61 hidden evidence versions cannot crowd out an applicable QMD answer", async () => {
  const w = workspace();
  try {
    const source = join(w.web, "answer.ts");
    const args = [
      "chart",
      "Where is the lighthouse answer?",
      "--files",
      "answer.ts",
    ];
    writeFileSync(source, "applicable evidence\n");
    const applicable = await w.run(args);
    expect(applicable.exitCode, applicable.stderr).toBe(0);
    for (let index = 0; index < 61; index++) {
      writeFileSync(source, `inapplicable evidence ${index}\n`);
      const result = await w.run([
        ...args,
        "--details",
        `lighthouse variant ${index}`,
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    writeFileSync(source, "applicable evidence\n");
    expect((await w.run(["init", "--no-embedding"])).exitCode).toBe(0);
    const asked = await w.run(["ask", "lighthouse answer"]);
    expect(asked.exitCode, asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout)).toMatchObject({
      id: applicable.stdout.slice(8),
      files: [source],
    });
    const registry = JSON.parse(
      readFileSync(join(w.home, ".capn/config.json"), "utf8")
    );
    const name = Object.keys(registry.workspaces)[0];
    if (!name) {
      throw new Error("No workspace registered");
    }
    expect(
      readdirSync(join(w.home, ".capn/workspaces", name, "entries"))
    ).toHaveLength(62);
  } finally {
    w.cleanup();
  }
}, 15_000);

test.concurrent("concurrent registrations preserve every alias and independent workspace", async () => {
  const w = workspace();
  try {
    const directories = Array.from({ length: 8 }, (_, index) =>
      join(w.base, `repository-${index}`)
    );
    for (const directory of directories) {
      mkdirSync(directory);
    }
    const results = await Promise.all(
      directories.map((directory, index) =>
        w.run(
          [
            "init",
            "--workspace",
            index < 6 ? "shop" : `isolated-${index}`,
            "--repo",
            `repo-${index}`,
            "--no-embedding",
          ],
          directory
        )
      )
    );
    for (const result of results) {
      expect(result.exitCode, result.stderr).toBe(0);
    }
    const registry = JSON.parse(
      readFileSync(join(w.home, ".capn/config.json"), "utf8")
    );
    expect(Object.keys(registry.workspaces).sort()).toEqual([
      "isolated-6",
      "isolated-7",
      "shop",
    ]);
    expect(Object.keys(registry.workspaces.shop.repos).sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `repo-${index}`)
    );
    expect(registry.workspaces.shop.bindings).toHaveLength(6);
    for (const directory of directories) {
      expect(existsSync(join(directory, ".capn"))).toBe(false);
    }
  } finally {
    w.cleanup();
  }
}, 15_000);

test.concurrent("a definitively dead lock owner is reclaimed without losing discoveries", async () => {
  const w = workspace();
  try {
    writeFileSync(join(w.web, "answer.ts"), "answer\n");
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const charted = await w.run([
      "chart",
      "Where is the recovered answer?",
      "--files",
      "answer.ts",
    ]);
    expect(charted.exitCode, charted.stderr).toBe(0);
    const departed = execa(
      process.execPath,
      ["-e", "process.stdout.write(String(process.pid))"],
      { env: w.env }
    );
    const exited = await departed;
    const lock = join(w.home, ".capn/locks/workspace-shop.lock");
    mkdirSync(lock);
    writeFileSync(
      join(lock, "dead-owner.json"),
      JSON.stringify({ pid: Number(exited.stdout) })
    );
    const asked = await w.run(["ask", "recovered answer"]);
    expect(asked.exitCode, asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout).id).toBe(charted.stdout.slice(8));
    expect(existsSync(lock)).toBe(false);
  } finally {
    w.cleanup();
  }
});

test.concurrent("incomplete and truncated disposable generations rebuild without losing shared records", async () => {
  const w = workspace();
  try {
    writeFileSync(join(w.web, "answer.ts"), "answer\n");
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const charted = await w.run([
      "chart",
      "Where is the durable answer?",
      "--files",
      "answer.ts",
    ]);
    expect(charted.exitCode, charted.stderr).toBe(0);
    const configPath = join(w.home, ".capn/config.json");
    const registry = JSON.parse(readFileSync(configPath, "utf8"));
    const generation = registry.workspaces.shop.bindings[0].generation;
    const view = join(w.home, ".capn/workspaces/shop/views", generation);
    const entry = join(
      w.home,
      ".capn/workspaces/shop/entries",
      `${charted.stdout.slice(8)}.md`
    );
    const authoritative = readFileSync(entry, "utf8");
    for (const damage of ["marker", "database"] as const) {
      if (damage === "marker") {
        rmSync(join(view, "ready.json"));
      } else {
        writeFileSync(join(view, "qmd/index.sqlite"), "");
      }
      const asked = await w.run(["ask", "durable answer"]);
      expect(asked.exitCode, asked.stderr).toBe(0);
      expect(JSON.parse(asked.stdout).id).toBe(charted.stdout.slice(8));
      expect(existsSync(join(view, "ready.json"))).toBe(true);
      expect(readFileSync(entry, "utf8")).toBe(authoritative);
    }
  } finally {
    w.cleanup();
  }
});

test.concurrent("Git-confirmed worktree removal cleans bindings and unused views while retaining discoveries", async () => {
  const w = workspace();
  try {
    expect((await w.git(["init", "-q"])).exitCode).toBe(0);
    await w.git(["config", "user.email", "test@example.com"]);
    await w.git(["config", "user.name", "Test"]);
    writeFileSync(join(w.web, "answer.ts"), "H1\n");
    await w.git(["add", "answer.ts"]);
    await w.git(["commit", "-qm", "seed"]);
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const args = [
      "chart",
      "Where is the retained answer?",
      "--files",
      "answer.ts",
    ];
    const first = await w.run(args);
    expect(first.exitCode, first.stderr).toBe(0);
    const branch = join(w.base, "branch");
    expect(
      (await w.git(["worktree", "add", "-qb", "feature", branch])).exitCode
    ).toBe(0);
    const wrongCheckout = await w.run(
      [
        "chart",
        "Where is alternate evidence?",
        "--files",
        join(w.web, "answer.ts"),
      ],
      branch
    );
    expect(wrongCheckout.exitCode).toBe(1);
    expect(wrongCheckout.stderr).toContain("outside workspace");
    writeFileSync(join(branch, "answer.ts"), "H2\n");
    const second = await w.run(args, branch);
    expect(second.exitCode, second.stderr).toBe(0);
    const configPath = join(w.home, ".capn/config.json");
    const before = JSON.parse(readFileSync(configPath, "utf8")).workspaces.shop;
    const oldBinding = before.bindings.find(
      (binding: { root: string }) => binding.root === branch
    );
    const moved = join(w.base, "moved");
    expect((await w.git(["worktree", "move", branch, moved])).exitCode).toBe(0);
    expect((await w.run(["ask", "retained answer"], moved)).exitCode).toBe(0);
    const afterMove = JSON.parse(readFileSync(configPath, "utf8")).workspaces
      .shop;
    expect(
      afterMove.bindings.find(
        (binding: { root: string }) => binding.root === moved
      ).id
    ).toBe(oldBinding.id);
    expect(
      afterMove.bindings.some(
        (binding: { root: string }) => binding.root === branch
      )
    ).toBe(false);
    const movedGeneration = afterMove.bindings.find(
      (binding: { root: string }) => binding.root === moved
    ).generation;
    const firstGeneration = afterMove.bindings.find(
      (binding: { root: string }) => binding.root === w.web
    ).generation;
    expect(movedGeneration).not.toBe(firstGeneration);
    expect(
      (await w.git(["worktree", "remove", "--force", moved])).exitCode
    ).toBe(0);
    const pruned = await w.run(["prune"]);
    expect(pruned.exitCode, pruned.stderr).toBe(0);
    const afterRemove = JSON.parse(readFileSync(configPath, "utf8")).workspaces
      .shop;
    expect(afterRemove.bindings).toHaveLength(1);
    expect(
      existsSync(join(w.home, ".capn/workspaces/shop/views", movedGeneration))
    ).toBe(false);
    expect(
      existsSync(join(w.home, ".capn/workspaces/shop/views", firstGeneration))
    ).toBe(true);
    expect(
      readdirSync(join(w.home, ".capn/workspaces/shop/entries"))
    ).toHaveLength(2);
    writeFileSync(join(w.web, "answer.ts"), "H2\n");
    expect(
      (await w.git(["worktree", "add", "-qb", "replacement", moved])).exitCode
    ).toBe(0);
    const replacement = await w.run(["ask", "retained answer"], moved);
    expect(replacement.exitCode, replacement.stderr).toBe(0);
    expect(JSON.parse(replacement.stdout).id).toBe(first.stdout.slice(8));
    const afterRecreate = JSON.parse(readFileSync(configPath, "utf8"))
      .workspaces.shop;
    expect(
      afterRecreate.bindings.find(
        (binding: { root: string }) => binding.root === moved
      ).id
    ).not.toBe(oldBinding.id);
    const restored = await w.run(["ask", "retained answer"]);
    expect(restored.exitCode, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout).id).toBe(second.stdout.slice(8));
  } finally {
    w.cleanup();
  }
}, 15_000);

test.concurrent("raw missing and locked worktrees remain registered instead of being mistaken for deleted", async () => {
  const w = workspace();
  try {
    await w.git(["init", "-q"]);
    await w.git(["config", "user.email", "test@example.com"]);
    await w.git(["config", "user.name", "Test"]);
    writeFileSync(join(w.web, "answer.ts"), "H1\n");
    await w.git(["add", "answer.ts"]);
    await w.git(["commit", "-qm", "seed"]);
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const branch = join(w.base, "branch");
    expect(
      (await w.git(["worktree", "add", "-qb", "feature", branch])).exitCode
    ).toBe(0);
    expect((await w.run(["list"], branch)).exitCode).toBe(0);
    const renamed = join(w.base, "raw-renamed");
    renameSync(branch, renamed);
    expect((await w.run(["prune"])).exitCode).toBe(0);
    const configPath = join(w.home, ".capn/config.json");
    expect(
      JSON.parse(readFileSync(configPath, "utf8")).workspaces.shop.bindings
    ).toHaveLength(2);
    renameSync(renamed, branch);
    expect((await w.git(["worktree", "lock", branch])).exitCode).toBe(0);
    rmSync(branch, { recursive: true, force: true });
    expect((await w.run(["prune"])).exitCode).toBe(0);
    expect(
      JSON.parse(readFileSync(configPath, "utf8")).workspaces.shop.bindings
    ).toHaveLength(2);
  } finally {
    w.cleanup();
  }
});

test.concurrent("a workspace named config cannot collide with the registry lock", async () => {
  const w = workspace();
  try {
    const initialized = await w.run([
      "init",
      "--workspace",
      "config",
      "--repo",
      "web",
      "--no-embedding",
    ]);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(join(w.home, ".capn/config.json"), "utf8"))
        .workspaces.config.bindings
    ).toHaveLength(1);
  } finally {
    w.cleanup();
  }
}, 5000);

test.concurrent("quoted newline and prototype-shaped filenames roundtrip through immutable records and recall", async () => {
  const w = workspace();
  try {
    const filenames = ["__proto__", 'line\nbreak"quoted.ts'];
    for (const file of filenames) {
      writeFileSync(join(w.web, file), "answer\n");
    }
    expect(
      (
        await w.run([
          "init",
          "--workspace",
          "shop",
          "--repo",
          "web",
          "--no-embedding",
        ])
      ).exitCode
    ).toBe(0);
    const charted = await w.run([
      "chart",
      "Where is the unusual filename answer?",
      "--files",
      filenames[0] ?? "",
      "--files",
      filenames[1] ?? "",
    ]);
    expect(charted.exitCode, charted.stderr).toBe(0);
    const asked = await w.run(["ask", "unusual filename answer"]);
    expect(asked.exitCode, asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout)).toMatchObject({
      id: charted.stdout.slice(8),
      files: filenames.map((file) => join(w.web, file)).sort(),
    });
    expect((await w.run(["list"])).exitCode).toBe(0);
  } finally {
    w.cleanup();
  }
});

test.concurrent("an unavailable companion hides joint discoveries but preserves independent answers and retained records", async () => {
  const w = workspace();
  try {
    writeFileSync(join(w.web, "answer.ts"), "web answer\n");
    writeFileSync(join(w.API, "answer.ts"), "API answer\n");
    for (const [cwd, alias] of [
      [w.web, "web"],
      [w.API, "api"],
    ] as const) {
      expect(
        (
          await w.run(
            ["init", "--workspace", "shop", "--repo", alias, "--no-embedding"],
            cwd
          )
        ).exitCode
      ).toBe(0);
    }
    const joint = await w.run([
      "chart",
      "Where is the coupled invoice answer?",
      "--files",
      `answer.ts,${join(w.API, "answer.ts")}`,
    ]);
    expect(joint.exitCode, joint.stderr).toBe(0);
    const independent = await w.run([
      "chart",
      "Where is the isolated lighthouse answer?",
      "--files",
      "answer.ts",
    ]);
    expect(independent.exitCode, independent.stderr).toBe(0);
    const unavailable = join(w.base, "unavailable");
    renameSync(w.API, unavailable);
    const missing = await w.run(["ask", "coupled invoice answer"]);
    expect(missing.exitCode).toBe(1);
    const stillApplies = await w.run(["ask", "isolated lighthouse answer"]);
    expect(stillApplies.exitCode, stillApplies.stderr).toBe(0);
    expect(JSON.parse(stillApplies.stdout).id).toBe(
      independent.stdout.slice(8)
    );
    expect((await w.run(["list"])).stdout).toContain(joint.stdout.slice(8));
    renameSync(unavailable, w.API);
    const restored = await w.run(["ask", "coupled invoice answer"]);
    expect(restored.exitCode, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout.split("\n")[0] ?? "").id).toBe(
      joint.stdout.slice(8)
    );
  } finally {
    w.cleanup();
  }
}, 15_000);

test.concurrent("bust forgets every applicable shadowed version without removing retained evidence versions", async () => {
  const w = workspace();
  try {
    const source = join(w.web, "answer.ts");
    writeFileSync(source, "H1\n");
    const args = [
      "chart",
      "Where is the layered answer?",
      "--files",
      "answer.ts",
    ];
    const retained = await w.run([...args, "--details", "H1 evidence"]);
    expect(retained.exitCode, retained.stderr).toBe(0);
    writeFileSync(source, "H2\n");
    for (const details of ["older H2 explanation", "newer H2 explanation"]) {
      const result = await w.run([...args, "--details", details]);
      expect(result.exitCode, result.stderr).toBe(0);
    }
    expect((await w.run(["init", "--no-embedding"])).exitCode).toBe(0);
    const busted = await w.run(["bust", "answer.ts"]);
    expect(busted.exitCode, busted.stderr).toBe(0);
    expect(busted.stdout).toContain("busted 2 entries");
    expect((await w.run(["ask", "layered answer"])).exitCode).toBe(1);
    expect((await w.run(["list"])).stdout).toContain(retained.stdout.slice(8));
    writeFileSync(source, "H1\n");
    const restored = await w.run(["ask", "layered answer"]);
    expect(restored.exitCode, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout).id).toBe(retained.stdout.slice(8));
  } finally {
    w.cleanup();
  }
});

test.concurrent("pruning from another repository follows a companion default worktree moved through Git", async () => {
  const w = workspace();
  try {
    await w.git(["init", "-q"], w.API);
    await w.git(["config", "user.email", "test@example.com"], w.API);
    await w.git(["config", "user.name", "Test"], w.API);
    writeFileSync(join(w.API, "orders.ts"), "orders\n");
    await w.git(["add", "orders.ts"], w.API);
    await w.git(["commit", "-qm", "seed"], w.API);
    const primary = join(w.base, "api-primary");
    expect(
      (await w.git(["worktree", "add", "-qb", "primary", primary], w.API))
        .exitCode
    ).toBe(0);
    writeFileSync(join(w.web, "checkout.ts"), "checkout\n");
    for (const [cwd, alias] of [
      [w.web, "web"],
      [primary, "api"],
    ] as const) {
      expect(
        (
          await w.run(
            ["init", "--workspace", "shop", "--repo", alias, "--no-embedding"],
            cwd
          )
        ).exitCode
      ).toBe(0);
    }
    const charted = await w.run([
      "chart",
      "Where does the portable checkout call orders?",
      "--files",
      `checkout.ts,${join(primary, "orders.ts")}`,
    ]);
    expect(charted.exitCode, charted.stderr).toBe(0);
    const moved = join(w.base, "api-moved");
    expect(
      (await w.git(["worktree", "move", primary, moved], w.API)).exitCode
    ).toBe(0);
    const pruned = await w.run(["prune"]);
    expect(pruned.exitCode, pruned.stderr).toBe(0);
    const asked = await w.run(["ask", "portable checkout orders"]);
    expect(asked.exitCode, asked.stderr).toBe(0);
    expect(JSON.parse(asked.stdout)).toMatchObject({
      id: charted.stdout.slice(8),
      files: [join(w.web, "checkout.ts"), join(moved, "orders.ts")].sort(),
    });
  } finally {
    w.cleanup();
  }
});

test.concurrent.each([
  ["ask", "Where is the answer?"],
  ["list"],
  ["prune"],
  ["unchart", "0123456789abcdef"],
  ["bust", "answer.ts"],
])("an unregistered %s cannot claim ownership before explicit initialization", async (...args) => {
  const w = workspace();
  try {
    writeFileSync(join(w.web, "answer.ts"), "export const answer = 1;\n");
    const lookup = await w.run(args);
    expect(existsSync(join(w.home, ".capn/config.json"))).toBe(false);
    expect(lookup.exitCode).toBe(1);
    expect(lookup.stderr).toContain("Run capn init");
    const initialized = await w.run([
      "init",
      "--workspace",
      "shop",
      "--repo",
      "web",
      "--no-embedding",
    ]);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const registry = JSON.parse(
      readFileSync(join(w.home, ".capn/config.json"), "utf8")
    );
    expect(Object.keys(registry.workspaces)).toEqual(["shop"]);
    expect(registry.workspaces.shop.bindings[0]).toMatchObject({
      root: w.web,
      alias: "web",
    });
  } finally {
    w.cleanup();
  }
});
