import { test as bunTest, expect } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

const capnPath = resolve(import.meta.dir, "../src/run.ts");
const test = bunTest.concurrent;

function workspace() {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), "capn-git-hooks-")));
  const repoDir = join(workDir, "repo");
  const binDir = join(workDir, "bin");
  mkdirSync(repoDir);
  mkdirSync(binDir);
  const shimPath = join(binDir, "capn");
  writeFileSync(
    shimPath,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CAPN_TEST_CALLS"\nexec "$CAPN_TEST_RUNTIME" "$CAPN_TEST_ENTRY" "$@"\n'
  );
  chmodSync(shimPath, 0o755);
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    ),
    HOME: join(workDir, "home"),
    XDG_CACHE_HOME: join(workDir, "cache"),
    XDG_CONFIG_HOME: join(workDir, "config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    CAPN_TEST_RUNTIME: process.execPath,
    CAPN_TEST_ENTRY: capnPath,
    CAPN_TEST_CALLS: join(workDir, "hook-calls"),
  };

  function run(command: string, args: string[], cwd = repoDir) {
    return execa(command, args, {
      cwd,
      env: { ...env, PWD: cwd },
      reject: false,
      stripFinalNewline: false,
    });
  }

  async function git(args: string[], cwd = repoDir) {
    const result = await run("git", args, cwd);
    expect(result.exitCode, result.stderr).toBe(0);
    return result;
  }

  async function capn(args: string[], cwd = repoDir) {
    const result = await run(process.execPath, [capnPath, ...args], cwd);
    expect(result.exitCode, result.stderr).toBe(0);
    return result;
  }

  return { workDir, repoDir, git, capn };
}

test.each([
  "default hooks",
  "relative core.hooksPath",
  "absolute core.hooksPath",
  "linked worktree",
  "separate Git directory",
])("init --git preserves and runs pruning with %s", async (layout) => {
  const { workDir, repoDir, git, capn } = workspace();
  try {
    const gitDir = join(workDir, "git-data");
    await git([
      "init",
      "-q",
      ...(layout === "separate Git directory"
        ? [`--separate-git-dir=${gitDir}`]
        : []),
    ]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Hook Test"]);

    let checkoutDir = repoDir;
    let hookPath = join(repoDir, ".git/hooks/post-commit");
    if (layout === "relative core.hooksPath") {
      await git(["config", "core.hooksPath", ".custom hooks"]);
      hookPath = join(repoDir, ".custom hooks/post-commit");
    } else if (layout === "absolute core.hooksPath") {
      const hooksDir = join(workDir, "shared hooks");
      await git(["config", "core.hooksPath", hooksDir]);
      hookPath = join(hooksDir, "post-commit");
    } else if (layout === "linked worktree") {
      await git(["commit", "-q", "--allow-empty", "-m", "initial"]);
      checkoutDir = join(workDir, "linked checkout");
      await git(["worktree", "add", "-q", "-b", "fixture", checkoutDir]);
    } else if (layout === "separate Git directory") {
      hookPath = join(gitDir, "hooks/post-commit");
    }

    mkdirSync(dirname(hookPath), { recursive: true });
    const existingHook = "#!/bin/sh\nprintf 'existing hook ran\\n'";
    writeFileSync(hookPath, existingHook);
    await capn(["init", "--git", "--no-embedding"], checkoutDir);
    const installedHook = readFileSync(hookPath, "utf8");
    expect(installedHook).toBe(`${existingHook}\ncapn prune\n`);
    await capn(["init", "--git", "--no-embedding"], checkoutDir);
    expect(readFileSync(hookPath, "utf8")).toBe(installedHook);

    const sourcePath = join(checkoutDir, "answer.ts");
    writeFileSync(sourcePath, "export const answer = 1;\n");
    const question = "Where is the answer defined?";
    await capn(["chart", question, "--files", "answer.ts"], checkoutDir);
    expect((await capn(["ask", question], checkoutDir)).stdout).toContain(
      question
    );
    const beforeConfig = JSON.parse(
      readFileSync(join(workDir, "home/.capn/config.json"), "utf8")
    );
    const beforeWorkspace = Object.values(beforeConfig.workspaces)[0] as {
      bindings: { root: string; generation?: string }[];
    };
    const beforeGeneration = beforeWorkspace.bindings.find(
      (binding) => binding.root === checkoutDir
    )?.generation;
    expect(beforeGeneration).toBeString();
    writeFileSync(sourcePath, "export const answer = 2;\n");
    expect((await capn(["list"], checkoutDir)).stdout).toContain(question);

    await git(["add", "answer.ts"], checkoutDir);
    const commit = await git(
      ["commit", "-q", "-m", "change answer"],
      checkoutDir
    );
    expect(commit.stdout + commit.stderr).toContain("existing hook ran\n");
    expect(
      readFileSync(join(workDir, "hook-calls"), "utf8").split("\n")
    ).toContain("prune");
    expect(commit.stdout + commit.stderr).toContain(
      "reconciled 0 applicable entries"
    );
    const afterConfig = JSON.parse(
      readFileSync(join(workDir, "home/.capn/config.json"), "utf8")
    );
    const afterWorkspace = Object.values(afterConfig.workspaces)[0] as {
      bindings: { root: string; generation?: string }[];
    };
    expect(
      afterWorkspace.bindings.find((binding) => binding.root === checkoutDir)
        ?.generation
    ).not.toBe(beforeGeneration);
    expect((await capn(["list"], checkoutDir)).stdout).toContain(question);
    writeFileSync(sourcePath, "export const answer = 1;\n");
    expect((await capn(["ask", question], checkoutDir)).stdout).toContain(
      question
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
