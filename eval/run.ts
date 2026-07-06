/// <reference types="bun" />

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type BunSpawnOptions = {
  cwd: string;
  env?: Record<string, string>;
  stderr: "pipe";
  stdin: "ignore";
  stdout: "pipe";
};

type BunSpawnResult = {
  exited: Promise<number>;
  stderr: ReadableStream<Uint8Array> | null;
  stdout: ReadableStream<Uint8Array> | null;
};

declare const Bun: {
  spawn(cmd: string[], options: BunSpawnOptions): BunSpawnResult;
  write(path: string, data: string | Uint8Array): Promise<number>;
};

type Phase = "baseline" | "a" | "b" | "all";
type Condition = "baseline" | "chart" | "recall";

type Options = {
  caseId: string | null;
  concurrency: number;
  phase: Phase;
  repoSlug: string;
  teardown: boolean;
};

type RepoLockEntry = {
  commit: string;
  slug: string;
};

type EvalCase = {
  groundTruthFiles: string[];
  id: string;
  question: string;
};

type CaseSet = {
  cases: EvalCase[];
  commit: string;
  repo: string;
};

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type TokenRecord = {
  cached_input_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

type CodexParseResult = {
  sessionId: string | null;
  tokens: TokenRecord;
  sawTurnCompleted: boolean;
};

type ChartHitMetrics = {
  anyRank: boolean;
  topRank: boolean;
};

type Provenance = {
  capnCommit: string;
  capnVersion: string;
  codexVersion: string;
  commit: string;
  concurrency: number;
  embeddingMode: boolean | null;
  endedAt: string;
  harnessGitRev: string;
  model: typeof codexModel;
  phase: Phase;
  reasoningEffort: typeof reasoningEffort;
  repo: string;
  startedAt: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const evalDir = scriptDir;
const runsDir = join(evalDir, "runs");
const workDir = join(runsDir, "work");
const capnBinDir = join(runsDir, ".capnbin");
const jsonLinePattern = /\r?\n/;
const codexModel = "gpt-5.5";
const reasoningEffort = "low";
let appendResultsChain = Promise.resolve();
const zeroTokens = (): TokenRecord => ({
  cached_input_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const writeProgress = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const die = (message: string): never => {
  throw new Error(message);
};

const readJSON = async (filePath: string): Promise<unknown> => {
  const text = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(text);
  return parsed;
};

const requireString = (
  record: Record<string, unknown>,
  key: string,
  context: string
): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    die(`${context} must include a non-empty ${key}`);
  }
  return value;
};

const parseRepoLock = (value: unknown): RepoLockEntry[] => {
  if (!(isRecord(value) && Array.isArray(value.repos))) {
    die("eval/repos.lock.json must contain a repos array");
  }

  const repos: RepoLockEntry[] = [];
  for (const repo of value.repos) {
    if (!isRecord(repo)) {
      die("Every repos.lock.json entry must be an object");
    }
    repos.push({
      commit: requireString(repo, "commit", "repos.lock.json entry"),
      slug: requireString(repo, "slug", "repos.lock.json entry"),
    });
  }
  return repos;
};

const parseCaseSet = (value: unknown): CaseSet => {
  if (!(isRecord(value) && Array.isArray(value.cases))) {
    die("eval/cases/<slug>.json must contain a cases array");
  }

  const cases: EvalCase[] = [];
  for (const evalCase of value.cases) {
    if (!isRecord(evalCase)) {
      die("Every case entry must be an object");
    }
    if (!Array.isArray(evalCase.groundTruthFiles)) {
      die("Every case entry must include groundTruthFiles");
    }

    const groundTruthFiles: string[] = [];
    for (const filePath of evalCase.groundTruthFiles) {
      if (typeof filePath !== "string" || filePath.length === 0) {
        die("groundTruthFiles must contain non-empty strings");
      }
      groundTruthFiles.push(filePath);
    }

    cases.push({
      groundTruthFiles,
      id: requireString(evalCase, "id", "case entry"),
      question: requireString(evalCase, "question", "case entry"),
    });
  }

  return {
    cases,
    commit: requireString(value, "commit", "case set"),
    repo: requireString(value, "repo", "case set"),
  };
};

const parsePhase = (value: string): Phase => {
  if (
    value === "baseline" ||
    value === "a" ||
    value === "b" ||
    value === "all"
  ) {
    return value;
  }
  die(`Unsupported --phase ${value}; expected baseline, a, b, or all`);
};

const parseConcurrency = (value: string): number => {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    die(`Unsupported --concurrency ${value}; expected a positive integer`);
  }
  return concurrency;
};

const readOptionValue = (
  args: string[],
  index: number,
  flag: string
): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    die(`${flag} requires a value`);
  }
  return value;
};

const parseArgs = (args: string[]): Options => {
  let caseId: string | null = null;
  let concurrency = 1;
  let phase: Phase = "all";
  let repoSlug: string | null = null;
  let teardown = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      repoSlug = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--case") {
      caseId = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--phase") {
      phase = parsePhase(readOptionValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      concurrency = parseConcurrency(readOptionValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--teardown") {
      teardown = true;
      continue;
    }
    die(`Unknown argument ${arg}`);
  }

  if (repoSlug === null) {
    die(
      "Usage: bun eval/run.ts --repo <slug> [--case <id>] [--phase baseline|a|b|all] [--concurrency <n>] [--teardown]"
    );
  }

  return { caseId, concurrency, phase, repoSlug, teardown };
};

const streamText = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => {
  if (stream === null) {
    return "";
  }
  return await new Response(stream).text();
};

const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
};

const makeEnv = (PATHPrefix: string | null): Record<string, string> => {
  const env = cleanEnv();
  if (PATHPrefix !== null) {
    const existingPATH = env.PATH ?? "";
    env.PATH = `${PATHPrefix}:${existingPATH}`;
  }
  return env;
};

const runPool = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item === undefined) {
        continue;
      }
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const appendResult = async (
  resultsFile: string,
  line: string
): Promise<void> => {
  const append = appendResultsChain.then(async () => {
    await appendFile(resultsFile, line);
  });
  appendResultsChain = append.catch(() => undefined);
  await append;
};

const runCommand = async (
  cmd: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<CommandResult> => {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: options.env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
};

const runRequiredStdout = async (
  cmd: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<string> => {
  const result = await runCommand(cmd, options);
  if (result.exitCode !== 0) {
    die(`${cmd.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
};

const readPackageVersion = async (): Promise<string> => {
  const packageJSON = await readJSON(join(repoRoot, "package.json"));
  if (!isRecord(packageJSON) || typeof packageJSON.version !== "string") {
    die("package.json must include a version string");
  }
  return packageJSON.version;
};

const readEmbeddingMode = async (
  capnWorktree: string
): Promise<boolean | null> => {
  try {
    const config = await readJSON(join(capnWorktree, ".capn", "config.json"));
    return isRecord(config) && typeof config.embedding === "boolean"
      ? config.embedding
      : null;
  } catch {
    return null;
  }
};

const writeProvenance = async (params: {
  capnWorktree: string;
  commit: string;
  options: Options;
  runRoot: string;
  startedAt: string;
}): Promise<void> => {
  const harnessGitRev = await runRequiredStdout(["git", "rev-parse", "HEAD"], {
    cwd: repoRoot,
  });
  const provenance: Provenance = {
    capnCommit: harnessGitRev,
    capnVersion: await readPackageVersion(),
    codexVersion: await runRequiredStdout(["codex", "--version"], {
      cwd: repoRoot,
    }),
    commit: params.commit,
    concurrency: params.options.concurrency,
    embeddingMode: await readEmbeddingMode(params.capnWorktree),
    endedAt: new Date().toISOString(),
    harnessGitRev,
    model: codexModel,
    phase: params.options.phase,
    reasoningEffort,
    repo: params.options.repoSlug,
    startedAt: params.startedAt,
  };
  await Bun.write(
    join(params.runRoot, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`
  );
};

const ensureCapnBin = async (): Promise<void> => {
  await mkdir(capnBinDir, { recursive: true });
  const linkPath = join(capnBinDir, "capn");
  await rm(linkPath, { force: true });
  await symlink(resolve(repoRoot, "bin/capn"), linkPath);
};

const isValidWorktree = async (worktreePath: string): Promise<boolean> => {
  if (!existsSync(worktreePath)) {
    return false;
  }

  const result = await runCommand(
    ["git", "-C", worktreePath, "rev-parse", "--is-inside-work-tree"],
    {
      cwd: repoRoot,
    }
  );
  return result.exitCode === 0 && result.stdout.trim() === "true";
};

const ensureWorktree = async (
  clonePath: string,
  worktreePath: string,
  commit: string
): Promise<void> => {
  if (existsSync(worktreePath)) {
    if (await isValidWorktree(worktreePath)) {
      writeProgress(`reusing worktree ${relative(repoRoot, worktreePath)}`);
      return;
    }
    die(
      `${relative(repoRoot, worktreePath)} exists but is not a valid git worktree`
    );
  }

  await mkdir(dirname(worktreePath), { recursive: true });
  writeProgress(`creating worktree ${relative(repoRoot, worktreePath)}`);
  const result = await runCommand(
    [
      "git",
      "-C",
      clonePath,
      "worktree",
      "add",
      "--force",
      worktreePath,
      commit,
    ],
    { cwd: repoRoot }
  );
  if (result.exitCode !== 0) {
    die(`git worktree add failed for ${worktreePath}:\n${result.stderr}`);
  }
};

const removeWorktree = async (
  clonePath: string,
  worktreePath: string
): Promise<void> => {
  if (!existsSync(worktreePath)) {
    writeProgress(`already absent ${relative(repoRoot, worktreePath)}`);
    return;
  }

  writeProgress(`removing worktree ${relative(repoRoot, worktreePath)}`);
  const result = await runCommand(
    ["git", "-C", clonePath, "worktree", "remove", "--force", worktreePath],
    {
      cwd: repoRoot,
    }
  );
  if (result.exitCode !== 0) {
    die(`git worktree remove failed for ${worktreePath}:\n${result.stderr}`);
  }
};

const ensureCapnInitialized = async (capnWorktree: string): Promise<void> => {
  // Pre-create .capn so capn's findProjectRoot resolves to this worktree instead
  // of walking up into an ancestor .capn — the eval worktrees live inside the
  // capn-hook repo, which has its own .capn at the repo root.
  await mkdir(join(capnWorktree, ".capn"), { recursive: true });
  if (!existsSync(join(capnWorktree, ".capn", "config.json"))) {
    writeProgress(`initializing capn in ${relative(repoRoot, capnWorktree)}`);
    const result = await runCommand(["capn", "init"], {
      cwd: capnWorktree,
      env: makeEnv(capnBinDir),
    });
    if (result.exitCode !== 0) {
      die(`capn init failed in ${capnWorktree}:\n${result.stderr}`);
    }
  }

  await rm(join(capnWorktree, ".codex", "hooks.json"), { force: true });
};

const captureCapnContext = async (capnWorktree: string): Promise<string> => {
  const result = await runCommand(["capn", "context"], {
    cwd: capnWorktree,
    env: makeEnv(capnBinDir),
  });
  if (result.exitCode !== 0) {
    die(`capn context failed in ${capnWorktree}:\n${result.stderr}`);
  }
  return result.stdout.trimEnd();
};

const taskForCondition = (question: string, condition: Condition): string => {
  const suffix =
    condition === "baseline"
      ? "Answer in one or two sentences naming the specific file(s)."
      : "Answer in one or two sentences naming the specific file(s). Follow any standing instructions in your session context.";
  return `Task: ${question} ${suffix}`;
};

const promptForCondition = (
  question: string,
  condition: Condition,
  capnContext: string | null
): string => {
  const task = taskForCondition(question, condition);
  if (condition === "baseline") {
    return task;
  }
  if (capnContext === null) {
    die("capn context is required for phase a/b prompts");
  }
  return `<session-context>\n${capnContext}\n</session-context>\n\n${task}`;
};

const toNumber = (value: unknown): number =>
  typeof value === "number" ? value : 0;

const parseUsage = (value: unknown): TokenRecord | null => {
  if (!isRecord(value)) {
    return null;
  }

  const inputTokens = toNumber(value.input_tokens);
  const outputTokens = toNumber(value.output_tokens);
  return {
    cached_input_tokens: toNumber(value.cached_input_tokens),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: toNumber(value.reasoning_output_tokens),
    total_tokens: inputTokens + outputTokens,
  };
};

const parseJSONLine = (line: string): unknown | null => {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed;
  } catch {
    return null;
  }
};

const parseCodexJSONL = (stdout: string): CodexParseResult => {
  let sessionId: string | null = null;
  let tokens = zeroTokens();
  let sawTurnCompleted = false;

  for (const line of stdout.split(jsonLinePattern)) {
    if (line.trim().length === 0) {
      continue;
    }

    const event = parseJSONLine(line);
    if (!isRecord(event)) {
      continue;
    }

    if (
      event.type === "thread.started" &&
      typeof event.thread_id === "string"
    ) {
      sessionId = event.thread_id;
      continue;
    }

    if (event.type === "turn.completed") {
      const usage = parseUsage(event.usage);
      if (usage !== null) {
        tokens = usage;
      }
      sawTurnCompleted = true;
    }
  }

  return { sawTurnCompleted, sessionId, tokens };
};

const pathParts = (filePath: string): string[] =>
  filePath.split("/").filter(Boolean);

const fileBasename = (filePath: string): string => {
  const parts = pathParts(filePath);
  return parts.at(-1) ?? filePath;
};

const fileTail = (filePath: string): string => {
  const parts = pathParts(filePath);
  if (parts.length < 2) {
    return filePath;
  }
  return `${parts.at(-2)}/${parts.at(-1)}`;
};

const includesText = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const gradeAnswer = (
  answerText: string,
  groundTruthFiles: string[]
): { ambiguous: boolean; correct: boolean } => {
  let basenameOnlyMatch = false;

  for (const groundTruthFile of groundTruthFiles) {
    if (
      includesText(answerText, groundTruthFile) ||
      includesText(answerText, fileTail(groundTruthFile))
    ) {
      return { ambiguous: false, correct: true };
    }
    if (includesText(answerText, fileBasename(groundTruthFile))) {
      basenameOnlyMatch = true;
    }
  }

  return { ambiguous: basenameOnlyMatch, correct: basenameOnlyMatch };
};

const filesOverlap = (
  candidateFiles: string[],
  groundTruthFiles: string[]
): boolean => {
  for (const candidateFile of candidateFiles) {
    const candidateBasename = fileBasename(candidateFile);
    for (const groundTruthFile of groundTruthFiles) {
      if (
        candidateFile === groundTruthFile ||
        candidateBasename === fileBasename(groundTruthFile) ||
        fileTail(candidateFile) === fileTail(groundTruthFile)
      ) {
        return true;
      }
    }
  }
  return false;
};

const parseChartFiles = (line: string): string[] | null => {
  const parsed = parseJSONLine(line);
  if (!(isRecord(parsed) && Array.isArray(parsed.files))) {
    return null;
  }

  const files: string[] = [];
  for (const filePath of parsed.files) {
    if (typeof filePath === "string") {
      files.push(filePath);
    }
  }
  return files;
};

const capnAskOutputs = (stdout: string): string[] => {
  const outputs: string[] = [];

  for (const line of stdout.split(jsonLinePattern)) {
    if (line.trim().length === 0) {
      continue;
    }

    const event = parseJSONLine(line);
    if (
      !isRecord(event) ||
      event.type !== "item.completed" ||
      !isRecord(event.item)
    ) {
      continue;
    }

    const { item } = event;
    if (
      item.type === "command_execution" &&
      typeof item.command === "string" &&
      item.command.includes("capn ask")
    ) {
      outputs.push(
        typeof item.aggregated_output === "string" ? item.aggregated_output : ""
      );
    }
  }

  return outputs;
};

const chartHitLines = (aggregatedOutput: string): string[] =>
  aggregatedOutput
    .split(jsonLinePattern)
    .filter((line) => line.trim().length > 0);

const chartHitForRecall = (
  stdout: string,
  groundTruthFiles: string[]
): ChartHitMetrics => {
  let anyRank = false;
  let topRank = false;

  for (const [askIndex, output] of capnAskOutputs(stdout).entries()) {
    for (const [hitIndex, hitLine] of chartHitLines(output).entries()) {
      const chartFiles = parseChartFiles(hitLine);
      const overlaps =
        chartFiles !== null && filesOverlap(chartFiles, groundTruthFiles);
      if (askIndex === 0 && hitIndex === 0) {
        topRank = overlaps;
      }
      if (overlaps) {
        anyRank = true;
      }
    }
  }

  return { anyRank, topRank };
};

const buildFlag = (
  exitCode: number,
  sawTurnCompleted: boolean
): string | null => {
  const flags: string[] = [];
  if (exitCode !== 0) {
    flags.push(`codex-exit-${exitCode}`);
  }
  if (!sawTurnCompleted) {
    flags.push("missing-turn-completed");
  }
  return flags.length === 0 ? null : flags.join(",");
};

const runCodexCase = async (params: {
  capnContext: string | null;
  case: EvalCase;
  condition: Condition;
  resultsFile: string;
  slug: string;
  worktreePath: string;
}): Promise<void> => {
  const answersDir = join(runsDir, params.slug, "answers");
  const logsDir = join(runsDir, params.slug, "logs");
  const promptsDir = join(runsDir, params.slug, "prompts");
  await mkdir(answersDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(promptsDir, { recursive: true });

  const answerFile = join(
    answersDir,
    `${params.case.id}-${params.condition}.txt`
  );
  const promptFile = join(
    promptsDir,
    `${params.case.id}-${params.condition}.txt`
  );
  const logFile = join(
    logsDir,
    `${params.case.id}-${params.condition}.jsonl.gz`
  );
  await rm(answerFile, { force: true });
  await rm(logFile, { force: true });
  await rm(join(logsDir, `${params.case.id}-${params.condition}.jsonl`), {
    force: true,
  });
  const prompt = promptForCondition(
    params.case.question,
    params.condition,
    params.capnContext
  );
  await Bun.write(promptFile, prompt);
  const env =
    params.condition === "baseline" ? makeEnv(null) : makeEnv(capnBinDir);
  const cmd = [
    "codex",
    "exec",
    "--cd",
    params.worktreePath,
    "--model",
    codexModel,
    "-c",
    `model_reasoning_effort=${reasoningEffort}`,
    "--sandbox",
    "danger-full-access",
    "--json",
    "--output-last-message",
    answerFile,
    prompt,
  ];

  writeProgress(`running ${params.condition} ${params.case.id}`);
  const startedAt = performance.now();
  const result = await runCommand(cmd, { cwd: repoRoot, env });
  const wallMs = Math.round(performance.now() - startedAt);
  await Bun.write(logFile, gzipSync(result.stdout));

  if (result.exitCode !== 0) {
    writeProgress(
      `codex exited ${result.exitCode} for ${params.condition} ${params.case.id}`
    );
    if (result.stderr.trim().length > 0) {
      writeProgress(result.stderr.trim());
    }
  }

  let answerText = "";
  try {
    answerText = await readFile(answerFile, "utf8");
  } catch {
    answerText = "";
  }

  const parsed = parseCodexJSONL(result.stdout);
  const grade = gradeAnswer(answerText, params.case.groundTruthFiles);
  const chartHitMetrics =
    params.condition === "recall"
      ? chartHitForRecall(result.stdout, params.case.groundTruthFiles)
      : null;
  const chartHit = chartHitMetrics === null ? null : chartHitMetrics.anyRank;

  const row = {
    ambiguous: grade.ambiguous,
    answerFile: relative(repoRoot, answerFile),
    at: new Date().toISOString(),
    caseId: params.case.id,
    chartHit,
    chartHitAnyRank: chartHitMetrics === null ? null : chartHitMetrics.anyRank,
    chartHitTopRank: chartHitMetrics === null ? null : chartHitMetrics.topRank,
    condition: params.condition,
    correct: grade.correct,
    flag: buildFlag(result.exitCode, parsed.sawTurnCompleted),
    sessionId: parsed.sessionId,
    tokens: parsed.tokens,
    wallMs,
  };
  await appendResult(params.resultsFile, `${JSON.stringify(row)}\n`);
};

const phaseCondition = (phase: Exclude<Phase, "all">): Condition => {
  if (phase === "baseline") {
    return "baseline";
  }
  return phase === "a" ? "chart" : "recall";
};

const phasesToRun = (phase: Phase): Exclude<Phase, "all">[] => {
  if (phase === "all") {
    return ["baseline", "a", "b"];
  }
  return [phase];
};

const selectedCases = (caseSet: CaseSet, caseId: string | null): EvalCase[] => {
  if (caseId === null) {
    return caseSet.cases;
  }

  const evalCase = caseSet.cases.find((item) => item.id === caseId);
  if (evalCase === undefined) {
    die(`No case ${caseId} found in eval/cases/${caseSet.repo}.json`);
  }
  return [evalCase];
};

const main = async (): Promise<void> => {
  const startedAt = new Date().toISOString();
  const options = parseArgs(process.argv.slice(2));
  const lockEntries = parseRepoLock(
    await readJSON(join(evalDir, "repos.lock.json"))
  );
  const lockEntry = lockEntries.find(
    (entry) => entry.slug === options.repoSlug
  );
  if (lockEntry === undefined) {
    die(`No repo ${options.repoSlug} found in eval/repos.lock.json`);
  }

  const clonePath = join(evalDir, "repos", options.repoSlug);
  const baselineWorktree = join(workDir, `${options.repoSlug}-baseline`);
  const capnWorktree = join(workDir, `${options.repoSlug}-capn`);

  if (options.teardown) {
    await removeWorktree(clonePath, baselineWorktree);
    await removeWorktree(clonePath, capnWorktree);
    return;
  }

  const caseSet = parseCaseSet(
    await readJSON(join(evalDir, "cases", `${options.repoSlug}.json`))
  );
  if (caseSet.repo !== options.repoSlug) {
    die(
      `Case file repo ${caseSet.repo} does not match --repo ${options.repoSlug}`
    );
  }
  if (caseSet.commit !== lockEntry.commit) {
    writeProgress(
      `warning: case file commit ${caseSet.commit} differs from repos.lock.json commit ${lockEntry.commit}`
    );
  }

  await ensureWorktree(clonePath, baselineWorktree, lockEntry.commit);
  await ensureWorktree(clonePath, capnWorktree, lockEntry.commit);
  await ensureCapnBin();
  await ensureCapnInitialized(capnWorktree);

  const cases = selectedCases(caseSet, options.caseId);
  const runRoot = join(runsDir, options.repoSlug);
  await mkdir(runRoot, { recursive: true });
  const resultsFile = join(runRoot, "results.jsonl");
  const needsCapnContext =
    options.phase === "all" || options.phase === "a" || options.phase === "b";
  const capnContext = needsCapnContext
    ? await captureCapnContext(capnWorktree)
    : null;

  for (const phase of phasesToRun(options.phase)) {
    const condition = phaseCondition(phase);
    const limit = condition === "chart" ? 1 : options.concurrency;
    const worktreePath =
      condition === "baseline" ? baselineWorktree : capnWorktree;
    await runPool(cases, limit, async (evalCase) => {
      await runCodexCase({
        capnContext,
        case: evalCase,
        condition,
        resultsFile,
        slug: options.repoSlug,
        worktreePath,
      });
    });
  }

  await writeProvenance({
    capnWorktree,
    commit: lockEntry.commit,
    options,
    runRoot,
    startedAt,
  });
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
