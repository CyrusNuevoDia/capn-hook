import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

type CommandHook = { args?: string[]; command?: string; type?: string };
type HookGroup = { hooks?: CommandHook[] };
type HookConfig = { hooks?: Record<string, HookGroup[]> };
const contextHook = { command: "/usr/bin/env capn context" };
const splitContextHook = { command: "/usr/bin/env", args: ["capn", "context"] };
const trailingNewlinePattern = /\n$/;

function sameArgs(left?: string[], right?: string[]) {
  const leftArgs = left ?? [];
  const rightArgs = right ?? [];
  return (
    leftArgs.length === rightArgs.length &&
    leftArgs.every((value, index) => value === rightArgs[index])
  );
}

function addCommandHook(
  config: HookConfig,
  event: string,
  { args, command }: { args?: string[]; command: string }
) {
  config.hooks ??= {};
  config.hooks[event] ??= [];
  if (
    config.hooks[event].some((group) =>
      group.hooks?.some(
        (hook) => hook.command === command && sameArgs(hook.args, args)
      )
    )
  ) {
    return;
  }
  config.hooks[event].push({
    hooks: [{ type: "command", command, ...(args ? { args } : {}) }],
  });
}

function removeCommandHooks(
  config: HookConfig,
  event: string,
  command: string,
  args?: string[]
) {
  const groups = config.hooks?.[event];
  if (!Array.isArray(groups)) {
    return;
  }
  const remainingGroups = groups
    .map((group) => ({
      ...group,
      hooks: group.hooks?.filter(
        (hook) => hook.command !== command || !sameArgs(hook.args, args)
      ),
    }))
    .filter((group) => (group.hooks?.length ?? 0) > 0);
  if (remainingGroups.length === 0) {
    delete config.hooks?.[event];
    return;
  }
  if (config.hooks) {
    config.hooks[event] = remainingGroups;
  }
}

function removeStopNudgeHooks(config: HookConfig) {
  const hooks = config.hooks;
  if (!hooks) {
    return;
  }
  const groups = hooks.Stop;
  if (!Array.isArray(groups)) {
    return;
  }
  const remainingGroups = groups
    .map((group) => ({
      ...group,
      hooks: group.hooks?.filter(
        (hook) =>
          !(
            typeof hook.command === "string" &&
            hook.command.includes("capn nudge")
          )
      ),
    }))
    .filter((group) => group.hooks?.length);
  if (remainingGroups.length === 0) {
    config.hooks = Object.fromEntries(
      Object.entries(hooks).filter(([event]) => event !== "Stop")
    );
    return;
  }
  hooks.Stop = remainingGroups;
}

export function installClaudeHooks(root: string) {
  const claudeDir = resolve(root, ".claude");
  const settingsPath = resolve(claudeDir, "settings.json");
  const localSettingsPath = resolve(claudeDir, "settings.local.json");
  mkdirSync(claudeDir, { recursive: true });
  let settings: HookConfig = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  }
  removeCommandHooks(settings, "SessionStart", "capn context");
  removeCommandHooks(
    settings,
    "SessionStart",
    splitContextHook.command,
    splitContextHook.args
  );
  addCommandHook(settings, "SessionStart", contextHook);
  removeStopNudgeHooks(settings);
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  if (existsSync(localSettingsPath)) {
    const localSettings = JSON.parse(
      readFileSync(localSettingsPath, "utf8")
    ) as HookConfig;
    removeCommandHooks(localSettings, "SessionStart", "capn context");
    removeCommandHooks(
      localSettings,
      "SessionStart",
      splitContextHook.command,
      splitContextHook.args
    );
    removeCommandHooks(localSettings, "SessionStart", contextHook.command);
    removeStopNudgeHooks(localSettings);
    writeFileSync(
      localSettingsPath,
      `${JSON.stringify(localSettings, null, 2)}\n`
    );
  }
}

export function installCodexHooks(root: string) {
  const codexDir = resolve(root, ".codex");
  const hooksPath = resolve(codexDir, "hooks.json");
  mkdirSync(codexDir, { recursive: true });
  let hooks: HookConfig = {};
  if (existsSync(hooksPath)) {
    hooks = JSON.parse(readFileSync(hooksPath, "utf8"));
  }
  removeCommandHooks(hooks, "SessionStart", "capn context");
  removeCommandHooks(
    hooks,
    "SessionStart",
    splitContextHook.command,
    splitContextHook.args
  );
  addCommandHook(hooks, "SessionStart", contextHook);
  removeStopNudgeHooks(hooks);
  writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
}

export function installPostCommit(root: string) {
  const hookPath = resolve(root, ".git/hooks/post-commit");
  const line = "capn prune";
  let body = "";
  mkdirSync(dirname(hookPath), { recursive: true });
  if (existsSync(hookPath)) {
    body = readFileSync(hookPath, "utf8");
  } else {
    body = "#!/bin/sh\n";
  }
  if (!body.includes(line)) {
    body = `${body}${body.endsWith("\n") ? "" : "\n"}${line}\n`;
    writeFileSync(hookPath, body);
  }
  chmodSync(hookPath, 0o755);
}

export function ensureGitignore(root: string) {
  const path = resolve(root, ".gitignore");
  const body = existsSync(path) ? readFileSync(path, "utf8") : "";
  const staleManaged = [".capn/qmd/", ".capn/journal/", ".capn/MIND.md"];
  const managed = [".capn/"];
  const lines =
    body.length === 0
      ? []
      : body
          .replace(trailingNewlinePattern, "")
          .split("\n")
          .filter(
            (line) => !(managed.includes(line) || staleManaged.includes(line))
          );
  lines.push(...managed);
  writeFileSync(path, `${lines.join("\n")}\n`);
}
