import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shellCommandPattern =
  /^(?:\/[^\s'";|&]+\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+['"]?(.*)$/s;
const askCommandPattern = /^(?:\/[^\s'";|&]+\/)?capn\s+ask(?:\s|$)/;

function runsAsk(command: string) {
  const shell = command.match(shellCommandPattern);
  return askCommandPattern.test(shell?.[1] ?? command);
}

function hasHit(output: string, entryId: string, file: string) {
  for (const line of output.split("\n")) {
    let hit: { id?: unknown; files?: unknown } | null;
    try {
      hit = JSON.parse(line);
    } catch {
      // Codex aggregates stdout and stderr; diagnostics aren't recall rows.
      continue;
    }
    if (
      hit?.id === entryId &&
      Array.isArray(hit.files) &&
      hit.files.some(
        (path: unknown) =>
          typeof path === "string" && resolve(path) === resolve(file)
      )
    ) {
      return true;
    }
  }
  return false;
}

function verifyRecall(path: string, entryId: string, file: string) {
  // Codex v0.160.1 exec_events.rs defines this --json command-event envelope:
  // https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/exec_events.rs
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    const item = event.item;
    if (
      event.type === "item.completed" &&
      item?.type === "command_execution" &&
      item.status === "completed" &&
      item.exit_code === 0 &&
      typeof item.command === "string" &&
      runsAsk(item.command) &&
      typeof item.aggregated_output === "string" &&
      hasHit(item.aggregated_output, entryId, file)
    ) {
      return;
    }
  }
  throw new Error(
    `No successful capn ask returned chart ${entryId} backed by ${file}`
  );
}

const [events, entryId, file] = process.argv.slice(2);
try {
  if (!(events && entryId && file) || process.argv.length !== 5) {
    throw new Error(
      "Usage: agent-e2e-capn.ts <codex-events.jsonl> <entryId> <file>"
    );
  }
  verifyRecall(events, entryId, file);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
