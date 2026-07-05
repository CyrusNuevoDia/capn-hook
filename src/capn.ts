import {
  ask,
  bust,
  chart,
  context,
  deleteEntry,
  init,
  listEntries,
  prune,
} from "./commands.ts";

export function usage() {
  return `Usage:
  capn init [--git] [--embedding|--no-embedding]
  capn context
  capn ask "<question>"
  capn chart "<question>" "<answer>" --files <a,b>
  capn unchart <id>
  capn bust <path>
  capn prune
  capn list
`;
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...commandArgs] = args;
  if (command === "--help" || command === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (!command) {
    process.stdout.write(usage());
    process.exit(1);
  }
  if (command === "chart") {
    await chart(commandArgs);
  } else if (command === "ask") {
    await ask(commandArgs);
  } else if (command === "bust") {
    await bust(commandArgs);
  } else if (command === "prune") {
    await prune();
  } else if (command === "unchart") {
    await deleteEntry(commandArgs[0]);
  } else if (command === "list") {
    listEntries();
  } else if (command === "context") {
    context();
  } else if (command === "init") {
    await init(commandArgs);
  } else {
    process.stdout.write(usage());
    process.exit(1);
  }
}
