#!/usr/bin/env bun
import {
  ask,
  bust,
  chart,
  consolidate,
  context,
  deleteEntry,
  init,
  listEntries,
  predict,
  prune,
  reflect,
  reward,
} from "./commands.ts";

function usage() {
  return `Usage:
  capn ask "<question>"
  capn chart "<question>" "<answer>" --files <a,b>
  capn unchart <id>
  capn reflect "<question>"
  capn predict "<prediction>"
  capn reward <id> <0..1> "<observation>"
  capn consolidate [--clear]
  capn bust <path>
  capn prune
  capn list
  capn context
  capn init [--git] [--embedding|--no-embedding]
`;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (!command) {
    process.stdout.write(usage());
    process.exit(1);
  }
  if (command === "chart") {
    await chart(args);
  } else if (command === "ask") {
    await ask(args);
  } else if (command === "reflect") {
    await reflect(args);
  } else if (command === "predict") {
    await predict(args);
  } else if (command === "reward") {
    await reward(args);
  } else if (command === "consolidate") {
    await consolidate(args);
  } else if (command === "bust") {
    await bust(args);
  } else if (command === "prune") {
    await prune();
  } else if (command === "unchart") {
    await deleteEntry(args[0]);
  } else if (command === "list") {
    listEntries();
  } else if (command === "context") {
    context();
  } else if (command === "init") {
    await init(args);
  } else {
    process.stdout.write(usage());
    process.exit(1);
  }
}
await main();
