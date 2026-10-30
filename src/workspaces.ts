import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { locked } from "./locks.ts";
import {
  type Checkout,
  canonical,
  capnDir,
  checkout,
  configPath,
  contains,
  git,
} from "./project.ts";
import { atomicWrite, sha256 } from "./util.ts";

export type Binding = Checkout & {
  id: string;
  alias: string;
  gitIdentity?: string;
  generation?: string;
};
type Repository = { primary: string; commonDir?: string };
export type Workspace = {
  embedding: boolean;
  initialized: boolean;
  repos: Record<string, Repository>;
  bindings: Binding[];
};
type Registry = { version: 1; workspaces: Record<string, Workspace> };
type Owner = { name: string; alias: string; binding?: Binding };
export type Context = {
  name: string;
  root: string;
  workspace: Workspace;
  binding: Binding;
  roots: Map<string, string>;
};
export type Registration = {
  create?: boolean;
  workspace?: string;
  repo?: string;
  embedding?: boolean;
  initialize?: boolean;
};
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const invalidNameCharacterPattern = /[^a-zA-Z0-9_-]/g;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validName(value: unknown): value is string {
  return typeof value === "string" && namePattern.test(value);
}
function absolute(value: unknown): value is string {
  return typeof value === "string" && resolve(value) === value;
}
function missing(path: string) {
  try {
    statSync(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}
function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}
function validCheckout(value: Record<string, unknown>) {
  return (
    absolute(value.root) &&
    (value.commonDir === undefined || absolute(value.commonDir)) &&
    (value.gitDir === undefined || absolute(value.gitDir))
  );
}
function validBinding(value: unknown, repos: Record<string, unknown>) {
  if (!(record(value) && validCheckout(value))) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    validName(value.alias) &&
    Object.hasOwn(repos, value.alias) &&
    optionalString(value.gitIdentity) &&
    (value.generation === undefined ||
      (typeof value.generation === "string" &&
        hashPattern.test(value.generation)))
  );
}
function validateWorkspace(name: string, value: unknown) {
  if (
    !(validName(name) && record(value)) ||
    typeof value.embedding !== "boolean" ||
    typeof value.initialized !== "boolean" ||
    !record(value.repos) ||
    !Array.isArray(value.bindings)
  ) {
    throw new Error(`Invalid capn workspace config: ${name}`);
  }
  const repos = value.repos;
  for (const [alias, repo] of Object.entries(repos)) {
    if (
      !(validName(alias) && record(repo) && absolute(repo.primary)) ||
      (repo.commonDir !== undefined && !absolute(repo.commonDir))
    ) {
      throw new Error(`Invalid capn repository config: ${alias}`);
    }
  }
  if (!value.bindings.every((binding) => validBinding(binding, repos))) {
    throw new Error(`Invalid capn checkout config: ${name}`);
  }
}
function registry(): Registry {
  if (!existsSync(configPath())) {
    return { version: 1, workspaces: Object.create(null) };
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    throw new Error(
      `Invalid capn config: ${configPath()}; repair it before continuing.`
    );
  }
  if (!record(value) || value.version !== 1 || !record(value.workspaces)) {
    throw new Error(`Invalid capn config: ${configPath()}`);
  }
  for (const [name, workspace] of Object.entries(value.workspaces)) {
    validateWorkspace(name, workspace);
  }
  return value as Registry;
}
function save(value: Registry) {
  atomicWrite(configPath(), `${JSON.stringify(value, null, 2)}\n`);
}
function workspaceRoot(name: string) {
  return resolve(capnDir(), "workspaces", name);
}
function defaultAlias(root: string) {
  return (
    basename(root).replace(invalidNameCharacterPattern, "-").slice(0, 60) ||
    "repo"
  );
}
function defaultName(root: string) {
  return `${defaultAlias(root)}-${sha256(root).slice(0, 8)}`;
}

function matchesCheckout(binding: Binding, current: Checkout) {
  return (
    binding.root === current.root ||
    (!(current.commonDir || binding.commonDir) &&
      contains(binding.root, current.root))
  );
}
function ownersInWorkspace(
  name: string,
  workspace: Workspace,
  current: Checkout
) {
  const matches: Owner[] = workspace.bindings
    .filter((binding) => matchesCheckout(binding, current))
    .map((binding) => ({ name, alias: binding.alias, binding }));
  if (!current.commonDir) {
    return matches;
  }
  for (const [alias, repo] of Object.entries(workspace.repos)) {
    if (
      repo.commonDir === current.commonDir &&
      !matches.some((match) => match.alias === alias)
    ) {
      matches.push({ name, alias });
    }
  }
  return matches;
}
function owner(value: Registry, current: Checkout) {
  const matches = Object.entries(value.workspaces).flatMap(
    ([name, workspace]) => ownersInWorkspace(name, workspace, current)
  );
  // Registered non-Git directories own their subtree; nested Git repositories are independent.
  if (!current.commonDir && matches.length > 1) {
    matches.sort(
      (a, b) => (b.binding?.root.length ?? 0) - (a.binding?.root.length ?? 0)
    );
    if (matches[0]?.binding?.root !== matches[1]?.binding?.root) {
      return matches[0];
    }
  }
  if (matches.length > 1) {
    throw new Error(
      "Conflicting workspace ownership; repair ~/.capn/config.json."
    );
  }
  return matches[0];
}
function selectedNames(
  existing: Owner | undefined,
  current: Checkout,
  options: Registration
) {
  if (!(existing || options.create)) {
    throw new Error("capn workspace is not registered. Run capn init.");
  }
  if (
    existing &&
    ((options.workspace && options.workspace !== existing.name) ||
      (options.repo && options.repo !== existing.alias))
  ) {
    throw new Error(
      `Checkout already belongs to workspace ${existing.name}, repository ${existing.alias}`
    );
  }
  const name = existing?.name ?? options.workspace ?? defaultName(current.root);
  const alias = existing?.alias ?? options.repo ?? defaultAlias(current.root);
  if (!(validName(name) && validName(alias))) {
    throw new Error(
      "Workspace and repo names must use letters, digits, underscores or hyphens (maximum 80 characters)."
    );
  }
  return { name, alias };
}
function gitIdentity(gitDir?: string) {
  if (!gitDir) {
    return;
  }
  const metadata = statSync(gitDir);
  // Git can reuse an administration path after removal. Its filesystem provenance
  // distinguishes a replacement from a branch switch or supported worktree move.
  return `${metadata.dev}:${metadata.ino}:${metadata.birthtimeMs}`;
}
function moveBinding(
  workspace: Workspace,
  binding: Binding,
  current: Checkout
) {
  const previous = binding.root;
  Object.assign(binding, current);
  const repo = workspace.repos[binding.alias];
  if (repo?.primary === previous) {
    repo.primary = current.root;
  }
}
function selectBinding(
  workspace: Workspace,
  existing: Owner | undefined,
  current: Checkout,
  alias: string
) {
  let binding = existing?.binding;
  if (!binding && current.gitDir) {
    binding = workspace.bindings.find(
      (item) => item.gitDir === current.gitDir && missing(item.root)
    );
  }
  if (
    binding &&
    (binding.commonDir !== current.commonDir ||
      binding.gitDir !== current.gitDir)
  ) {
    throw new Error(
      "Checkout Git association changed; repair its registration in ~/.capn/config.json before continuing."
    );
  }
  const provenance = gitIdentity(current.gitDir);
  if (binding && binding.gitIdentity !== provenance) {
    const replacedId = binding.id;
    workspace.bindings = workspace.bindings.filter(
      (item) => item.id !== replacedId
    );
    binding = undefined;
  }
  if (!binding) {
    binding = {
      ...current,
      id: randomUUID(),
      alias,
      ...(provenance ? { gitIdentity: provenance } : {}),
    };
    workspace.bindings.push(binding);
  } else if (binding.root !== current.root) {
    moveBinding(workspace, binding, current);
  }
  return binding;
}
function selectWorkspace(value: Registry, name: string, options: Registration) {
  if (Object.hasOwn(value.workspaces, name)) {
    return value.workspaces[name];
  }
  const workspace: Workspace = {
    embedding: options.embedding ?? true,
    initialized: false,
    repos: Object.create(null),
    bindings: [],
  };
  value.workspaces[name] = workspace;
  return workspace;
}
function register(value: Registry, current: Checkout, options: Registration) {
  const existing = owner(value, current);
  const { name, alias } = selectedNames(existing, current, options);
  const workspace = selectWorkspace(value, name, options);
  const priorRepo = Object.hasOwn(workspace.repos, alias)
    ? workspace.repos[alias]
    : undefined;
  if (priorRepo && !existing) {
    throw new Error(
      `Repository alias ${alias} already belongs to another repository in ${name}`
    );
  }
  if (!priorRepo) {
    workspace.repos[alias] = {
      primary: current.root,
      ...(current.commonDir ? { commonDir: current.commonDir } : {}),
    };
  }
  const selectedCheckout =
    !current.commonDir && existing?.binding
      ? { root: existing.binding.root }
      : current;
  const binding = selectBinding(workspace, existing, selectedCheckout, alias);
  if (options.embedding !== undefined) {
    workspace.embedding = options.embedding;
  }
  if (options.initialize) {
    workspace.initialized = true;
  }
  return { name, workspace, binding };
}
function contextFor(selected: {
  name: string;
  workspace: Workspace;
  binding: Binding;
}): Context {
  const roots = new Map(
    Object.entries(selected.workspace.repos).map(([alias, repo]) => [
      alias,
      repo.primary,
    ])
  );
  roots.set(selected.binding.alias, selected.binding.root);
  return { ...selected, root: workspaceRoot(selected.name), roots };
}
function registeredContext(
  current: Checkout,
  options: Registration,
  heldName: string,
  beforeSave?: (context: Context) => void
) {
  const value = registry();
  const { name } = selectedNames(owner(value, current), current, options);
  if (name !== heldName) {
    return;
  }
  const context = contextFor(register(value, current, options));
  beforeSave?.(context);
  save(value);
  return context;
}
export async function inWorkspace<T>(
  options: Registration,
  action: (context: Context) => T | Promise<T>,
  beforeSave?: (context: Context) => void
) {
  const current = checkout(process.cwd());
  for (let attempt = 0; attempt < 4; attempt++) {
    const { name } = selectedNames(
      owner(registry(), current),
      current,
      options
    );
    const outcome = await locked(
      resolve(capnDir(), "locks", `workspace-${name}.lock`),
      async () => {
        const context = await locked(
          resolve(capnDir(), "locks", "config.lock"),
          () => registeredContext(current, options, name, beforeSave)
        );
        // Registration can change while waiting. Release this lock before routing
        // to the actual owner so every action holds the workspace it modifies.
        if (!context) {
          return { retry: true as const };
        }
        return { retry: false as const, value: await action(context) };
      }
    );
    if (!outcome.retry) {
      return outcome.value;
    }
  }
  throw new Error("Checkout ownership keeps changing; retry the command.");
}
export async function persistBinding(context: Context) {
  await locked(resolve(capnDir(), "locks", "config.lock"), () => {
    const value = registry();
    const workspace = value.workspaces[context.name];
    if (!workspace) {
      throw new Error("Workspace registration disappeared");
    }
    workspace.bindings = context.workspace.bindings;
    for (const [alias, repo] of Object.entries(context.workspace.repos)) {
      workspace.repos[alias] = repo;
    }
    save(value);
  });
}

function checkoutMatches(
  context: Context,
  alias: string,
  root: string,
  path: string
) {
  const actual = checkout(dirname(path));
  const repo = context.workspace.repos[alias];
  return !(
    (actual.commonDir && actual.root !== root) ||
    (repo?.commonDir && actual.commonDir !== repo.commonDir)
  );
}
export function logicalFile(context: Context, file: string) {
  const path = canonical(resolve(process.cwd(), file));
  const selected = [...context.roots]
    .filter(([, root]) => contains(root, path))
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (!selected) {
    throw new Error(`file is outside workspace selected checkouts: ${file}`);
  }
  const [alias, root] = selected;
  // Nested independent Git roots can't masquerade as part of their parent repo.
  if (!checkoutMatches(context, alias, root, path)) {
    throw new Error(
      `file belongs to an unrelated or alternate checkout: ${file}`
    );
  }
  return {
    absolute: path,
    logical: `${alias}/${relative(root, path).split(sep).join("/")}`,
  };
}
export function backingFile(context: Context, logical: string) {
  const slash = logical.indexOf("/");
  const alias = logical.slice(0, slash);
  const part = logical.slice(slash + 1);
  const root = context.roots.get(alias);
  if (
    !root ||
    slash < 1 ||
    !part ||
    part.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return;
  }
  try {
    const path = canonical(resolve(root, part));
    if (contains(root, path) && checkoutMatches(context, alias, root, path)) {
      return path;
    }
  } catch {
    /* Unavailable or broken companion metadata suppresses this evidence. */
  }
}

type WorktreeRecord = { root: string };
function worktreeRecords(
  commonDir: string,
  cwd: string
): WorktreeRecord[] | undefined {
  const result = git(
    [`--git-dir=${commonDir}`, "worktree", "list", "--porcelain", "-z"],
    cwd
  );
  if (result.exitCode !== 0 || !result.stdout.endsWith("\0\0")) {
    return;
  }
  const records: WorktreeRecord[] = [];
  for (const block of result.stdout.slice(0, -2).split("\0\0")) {
    const [first] = block.split("\0");
    const root = first?.slice("worktree ".length);
    if (!(first?.startsWith("worktree ") && absolute(root))) {
      return;
    }
    records.push({ root: canonical(root) });
  }
  return records;
}
function movedRoot(binding: Binding, records: WorktreeRecord[]) {
  if (
    !binding.gitDir ||
    binding.gitDir === binding.commonDir ||
    !existsSync(binding.gitDir)
  ) {
    return;
  }
  try {
    const link = readFileSync(
      resolve(binding.gitDir, "gitdir"),
      "utf8"
    ).trimEnd();
    const root = canonical(dirname(link));
    if (records.some((record) => record.root === root)) {
      return root;
    }
  } catch {
    /* Inaccessible administration metadata never proves removal. */
  }
}
function reconcileMissingBinding(
  workspace: Workspace,
  binding: Binding,
  records: WorktreeRecord[]
) {
  if (records.some((record) => record.root === binding.root)) {
    return false;
  }
  const moved = movedRoot(binding, records);
  if (moved) {
    moveBinding(workspace, binding, {
      root: moved,
      commonDir: binding.commonDir,
      gitDir: binding.gitDir,
    });
    return false;
  }
  // Existing administration data can be inaccessible or damaged. Only an absent
  // admin directory and a complete Git registry establish a removed checkout.
  return Boolean(binding.gitDir && missing(binding.gitDir));
}
function collectGenerations(context: Context) {
  const referenced = new Set(
    context.workspace.bindings
      .map((binding) => binding.generation)
      .filter(Boolean)
  );
  const views = resolve(context.root, "views");
  if (!existsSync(views)) {
    return;
  }
  for (const name of readdirSync(views)) {
    if (hashPattern.test(name) && !referenced.has(name)) {
      rmSync(resolve(views, name), { recursive: true, force: true });
    }
  }
}
export async function cleanupBindings(context: Context) {
  const removed = new Set<string>();
  const lists = new Map<string, WorktreeRecord[] | undefined>();
  for (const binding of context.workspace.bindings) {
    if (
      !(
        missing(binding.root) &&
        binding.commonDir &&
        existsSync(binding.commonDir)
      )
    ) {
      continue;
    }
    if (!lists.has(binding.commonDir)) {
      lists.set(
        binding.commonDir,
        worktreeRecords(binding.commonDir, context.binding.root)
      );
    }
    const records = lists.get(binding.commonDir);
    if (!records) {
      continue;
    }
    if (reconcileMissingBinding(context.workspace, binding, records)) {
      removed.add(binding.id);
    }
  }
  context.workspace.bindings = context.workspace.bindings.filter(
    (binding) => !removed.has(binding.id)
  );
  await persistBinding(context);
  collectGenerations(context);
  return removed.size;
}
