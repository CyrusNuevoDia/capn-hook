import { readFile } from "node:fs/promises";
import { execaSync } from "execa";

const packageName = "capn-hook";
const releaseTypes = ["patch", "minor", "major"] as const;
const changeStatuses = ["A", "C", "M", "R", "D"] as const;
const relativePathPrefixPattern = /^\.\//;
const changesetReleaseLinePattern = /^"([^"]+)":\s*([A-Za-z0-9_-]+)\s*$/;

type ReleaseType = (typeof releaseTypes)[number];
type ChangeStatus = (typeof changeStatuses)[number];

type ChangedFile = {
  status: ChangeStatus;
  paths: string[];
};

type ReleaseEntry = {
  packageName: string;
  releaseType: ReleaseType;
};

type ParsedChangeset = {
  empty: boolean;
  filePath: string;
  releases: ReleaseEntry[];
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runGit(args: string[]): string {
  const result = execaSync("git", args, {
    reject: false,
  });

  if (result.exitCode !== 0) {
    const command = ["git", ...args].join(" ");
    const stderr = result.stderr.trim();
    const detail = stderr.length > 0 ? `\n${stderr}` : "";

    fail(`Git command failed: ${command}${detail}`);
  }

  return result.stdout.trimEnd();
}

function tryRunGit(args: string[]): string | undefined {
  const result = execaSync("git", args, {
    reject: false,
  });

  if (result.exitCode !== 0) {
    return;
  }

  return result.stdout.trimEnd();
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(relativePathPrefixPattern, "");
}

function isChangeStatus(status: string): status is ChangeStatus {
  return changeStatuses.includes(status as ChangeStatus);
}

function parseNameStatus(diffOutput: string): ChangedFile[] {
  const changes: ChangedFile[] = [];

  for (const line of diffOutput.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const [rawStatus, ...rawPaths] = line.split("\t");
    const status = rawStatus?.[0];

    if (status === undefined || !isChangeStatus(status)) {
      fail(`Unable to parse git diff status line: ${line}`);
    }

    const paths = rawPaths
      .map(normalizePath)
      .filter((filePath) => filePath.length > 0);

    if (paths.length === 0) {
      fail(`Git diff status line did not include a path: ${line}`);
    }

    changes.push({ paths, status });
  }

  return changes;
}

function isChangesetPath(filePath: string): boolean {
  if (!(filePath.startsWith(".changeset/") && filePath.endsWith(".md"))) {
    return false;
  }

  return !filePath.slice(".changeset/".length).includes("/");
}

function isReleaseInputPath(filePath: string): boolean {
  return (
    filePath === "package.json" ||
    filePath === "bun.lock" ||
    filePath === "README.md" ||
    filePath === "INSTALL.md" ||
    filePath === "GOAL.md" ||
    filePath === "CHANGELOG.md" ||
    filePath === "justfile" ||
    filePath.startsWith("src/") ||
    filePath.startsWith(".changeset/") ||
    filePath === "scripts/check-release-changeset.ts" ||
    filePath.startsWith(".github/workflows/")
  );
}

function currentPath(change: ChangedFile): string {
  const pathIndex = change.status === "D" ? 0 : change.paths.length - 1;
  const filePath = change.paths[pathIndex];

  if (filePath === undefined) {
    fail(
      `Git diff entry did not include a usable path for status ${change.status}.`
    );
  }

  return filePath;
}

function changedReleaseInputPaths(changes: ChangedFile[]): string[] {
  const paths = new Set<string>();

  for (const change of changes) {
    for (const filePath of change.paths) {
      if (isReleaseInputPath(filePath) && !isChangesetPath(filePath)) {
        paths.add(filePath);
      }
    }
  }

  return [...paths].sort();
}

function changedChangesetFiles(changes: ChangedFile[]): ChangedFile[] {
  return changes.filter((change) => change.paths.some(isChangesetPath));
}

function parseableChangesetPaths(changesets: ChangedFile[]): string[] {
  const paths = new Set<string>();

  for (const changeset of changesets) {
    if (changeset.status === "D") {
      continue;
    }

    const filePath = currentPath(changeset);

    if (isChangesetPath(filePath)) {
      paths.add(filePath);
    }
  }

  return [...paths].sort();
}

function untrackedChangesetChanges(): ChangedFile[] {
  const output = runGit([
    "ls-files",
    "--others",
    "--exclude-standard",
    ".changeset/*.md",
  ]);

  return output
    .split("\n")
    .map((filePath) => normalizePath(filePath))
    .filter(isChangesetPath)
    .map((filePath) => ({ paths: [filePath], status: "A" }));
}

function formatChangedFile(change: ChangedFile): string {
  if (change.paths.length === 1) {
    const filePath = change.paths[0];

    if (filePath === undefined) {
      fail(
        `Git diff entry did not include a usable path for status ${change.status}.`
      );
    }

    return `${change.status} ${filePath}`;
  }

  const firstPath = change.paths[0];
  const lastPath = change.paths.at(-1);

  if (firstPath === undefined || lastPath === undefined) {
    fail(
      `Git diff entry did not include usable rename paths for status ${change.status}.`
    );
  }

  return `${change.status} ${firstPath} -> ${lastPath}`;
}

function printDiagnostics(
  releasePaths: string[],
  changesets: ChangedFile[]
): void {
  console.log("Changed release input files:");

  if (releasePaths.length === 0) {
    console.log("- none");
  } else {
    for (const filePath of releasePaths) {
      console.log(`- ${filePath}`);
    }
  }

  console.log("Changed changeset files:");

  if (changesets.length === 0) {
    console.log("- none");
  } else {
    for (const changeset of changesets) {
      console.log(`- ${formatChangedFile(changeset)}`);
    }
  }
}

function isReleaseType(value: string): value is ReleaseType {
  return releaseTypes.includes(value as ReleaseType);
}

function parseChangeset(content: string, filePath: string): ParsedChangeset {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const fenceIndices: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line?.trim() === "---") {
      fenceIndices.push(index);
    }

    if (fenceIndices.length === 2) {
      break;
    }
  }

  const firstFence = fenceIndices[0];
  const secondFence = fenceIndices[1];

  if (firstFence === undefined || secondFence === undefined) {
    fail(`${filePath}: missing frontmatter fences.`);
  }

  if (firstFence !== 0) {
    fail(`${filePath}: frontmatter must start with a --- fence.`);
  }

  const frontmatter = lines.slice(firstFence + 1, secondFence).join("\n");

  if (frontmatter.trim() === "") {
    return {
      empty: true,
      filePath,
      releases: [],
    };
  }

  const releases: ReleaseEntry[] = [];

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "") {
      continue;
    }

    const releaseLine = changesetReleaseLinePattern.exec(trimmed);

    if (releaseLine === null) {
      fail(`${filePath}: malformed frontmatter line: ${trimmed}`);
    }

    const releasePackageName = releaseLine[1];
    const releaseType = releaseLine[2];

    if (releasePackageName === undefined || releaseType === undefined) {
      fail(`${filePath}: malformed frontmatter line: ${trimmed}`);
    }

    if (!isReleaseType(releaseType)) {
      fail(
        `${filePath}: unsupported release type "${releaseType}" for "${releasePackageName}".`
      );
    }

    releases.push({ packageName: releasePackageName, releaseType });
  }

  return {
    empty: false,
    filePath,
    releases,
  };
}

async function readChangedChangesets(
  filePaths: string[]
): Promise<ParsedChangeset[]> {
  const changesets: ParsedChangeset[] = [];

  for (const filePath of filePaths) {
    const content = await readFile(filePath, "utf8");
    changesets.push(parseChangeset(content, filePath));
  }

  return changesets;
}

function shouldSkipGeneratedVersionCommit(): boolean {
  const latestCommitSubject = runGit(["log", "-1", "--pretty=%s"]);

  if (
    latestCommitSubject.startsWith("chore(release): bump capn-hook version")
  ) {
    console.log(
      `Skipping release changeset enforcement for generated version commit: ${latestCommitSubject}`
    );
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  if (shouldSkipGeneratedVersionCommit()) {
    return;
  }

  const baseBranch = process.env.GITHUB_BASE_REF?.trim() || "main";
  const mergeBase =
    tryRunGit(["merge-base", "HEAD", `origin/${baseBranch}`]) ??
    tryRunGit(["merge-base", "HEAD", baseBranch]) ??
    "HEAD";
  const diffOutput = runGit([
    "diff",
    "--name-status",
    "--diff-filter=ACMRD",
    mergeBase,
    "HEAD",
  ]);
  const changes = [
    ...parseNameStatus(diffOutput),
    ...untrackedChangesetChanges(),
  ];
  const releasePaths = changedReleaseInputPaths(changes);
  const changesets = changedChangesetFiles(changes);
  const parsePaths = parseableChangesetPaths(changesets);

  printDiagnostics(releasePaths, changesets);

  const parsedChangesets = await readChangedChangesets(parsePaths);

  if (releasePaths.length === 0) {
    console.log("No published package inputs changed; no changeset required.");
    return;
  }

  if (changesets.length === 0) {
    fail(
      "Published package inputs changed, but no changed .changeset/*.md file was found."
    );
  }

  if (parsedChangesets.length === 0) {
    fail(
      "Published package inputs changed, but no non-deleted changed changeset file remains to parse."
    );
  }

  const hasPackageRelease = parsedChangesets.some((changeset) =>
    changeset.releases.some((release) => release.packageName === packageName)
  );
  const hasEmptyChangeset = parsedChangesets.some(
    (changeset) => changeset.empty
  );
  const unsupportedReleases = parsedChangesets.flatMap((changeset) =>
    changeset.releases
      .filter((release) => release.packageName !== packageName)
      .map((release) => `${changeset.filePath}: "${release.packageName}"`)
  );

  if (unsupportedReleases.length > 0) {
    fail(
      [
        `Changesets in this repo may only release "${packageName}" or be empty.`,
        ...unsupportedReleases.map((release) => `- ${release}`),
      ].join("\n")
    );
  }

  if (hasPackageRelease || hasEmptyChangeset) {
    console.log("Release changeset check passed.");
    return;
  }

  fail(
    `Published package inputs changed, but no changed changeset targets "${packageName}" and no changed changeset is empty.`
  );
}

await main();
