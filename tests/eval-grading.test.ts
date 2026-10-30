import { test as bunTest, expect } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";

const test = bunTest.concurrent;
const gradingURL = pathToFileURL(
  resolve(import.meta.dir, "../eval/grading.ts")
).href;

async function grade(answer: string, files: string[]) {
  const workDir = await mkdtemp(join(tmpdir(), "capn-grading-test-"));
  const homeDir = join(workDir, ".home");
  try {
    await mkdir(homeDir);
    const result = await execa(
      process.execPath,
      [
        "-e",
        `import { gradeAnswer } from ${JSON.stringify(gradingURL)};
const { answer, files } = await Bun.stdin.json();
console.log(JSON.stringify(gradeAnswer(answer, files)));`,
      ],
      {
        cwd: workDir,
        env: { HOME: homeDir },
        input: JSON.stringify({ answer, files }),
      }
    );
    return JSON.parse(result.stdout);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

test("answer grading requires every file and reports partial coverage", async () => {
  const result = await grade("See `src/capture.ts`.", [
    "src/capture.ts",
    "src/ingest.ts",
  ]);
  expect(result.correct).toBe(false);
  expect(result.scoring).toBe("required-files-v1");
  expect(result.coverage).toEqual({
    ambiguousFiles: [],
    matchedFiles: ["src/capture.ts"],
    missingFiles: ["src/ingest.ts"],
    requiredFiles: ["src/capture.ts", "src/ingest.ts"],
    fraction: 0.5,
    status: "partial",
  });
});

test("answer grading accepts complete file coverage", async () => {
  const result = await grade("`src/capture.ts` calls `src/ingest.ts`.", [
    "src/capture.ts",
    "src/ingest.ts",
  ]);
  expect(result.correct).toBe(true);
  expect(result.ambiguous).toBe(false);
  expect(result.coverage.status).toBe("complete");
  expect(result.coverage.fraction).toBe(1);
});

test("answer grading leaves basename collisions ambiguous", async () => {
  const result = await grade("The answer is in `index.ts`.", [
    "src/server/index.ts",
    "src/client/index.ts",
  ]);
  expect(result.correct).toBe(false);
  expect(result.ambiguous).toBe(true);
  expect(result.coverage.ambiguousFiles).toEqual([
    "src/server/index.ts",
    "src/client/index.ts",
  ]);
  expect(result.coverage.matchedFiles).toEqual([]);
  expect(result.coverage.fraction).toBe(0);
});

test("answer grading rejects path substrings and differently cased files", async () => {
  const result = await grade(
    "`src/handler.tsx`, `src/handler.ts.bak`, `wrongsrc/handler.ts`, `SRC/handler.ts`.",
    ["src/handler.ts"]
  );
  expect(result.correct).toBe(false);
  expect(result.ambiguous).toBe(false);
  expect(result.coverage.matchedFiles).toEqual([]);
});

test("answer grading accepts Markdown, code, line references, and absolute prefixes", async () => {
  const result = await grade(
    "[route](apps/web/app/(ee)/api/[id]/route.ts:42)\n" +
      "```\n./src/capture.ts:10:2\n```\n" +
      "`/tmp/checkouts/repo/src/ingest.ts#L15`",
    ["apps/web/app/(ee)/api/[id]/route.ts", "src/capture.ts", "src/ingest.ts"]
  );
  expect(result.correct).toBe(true);
  expect(result.coverage.status).toBe("complete");
});

test("answer grading requires a qualified path even for unique basenames", async () => {
  const result = await grade("`capture.ts` and `pipeline/ingest.ts`.", [
    "src/capture.ts",
    "src/pipeline/ingest.ts",
  ]);
  expect(result.correct).toBe(false);
  expect(result.ambiguous).toBe(true);
  expect(result.coverage.missingFiles).toEqual([
    "src/capture.ts",
    "src/pipeline/ingest.ts",
  ]);
});

test("answer grading does not award empty ground truth complete coverage", async () => {
  const result = await grade("No files.", []);
  expect(result.correct).toBe(false);
  expect(result.coverage.status).toBe("missing");
});
