import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

function release(path: string, owner: string) {
  try {
    unlinkSync(resolve(path, owner));
  } catch {
    return;
  }
  try {
    rmdirSync(path);
  } catch {
    /* Another contender may already hold the path. */
  }
}

function reap(path: string) {
  try {
    const owners = readdirSync(path);
    if (owners.length !== 1 || !owners[0]?.endsWith(".json")) {
      return;
    }
    const owner = owners[0];
    const metadata = JSON.parse(readFileSync(resolve(path, owner), "utf8"));
    if (!Number.isSafeInteger(metadata.pid) || metadata.pid < 1) {
      return;
    }
    try {
      process.kill(metadata.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        release(path, owner);
      }
    }
  } catch {
    /* In-flight acquisition or release; retry without guessing ownership. */
  }
}

export async function locked<T>(path: string, action: () => T | Promise<T>) {
  mkdirSync(dirname(path), { recursive: true });
  const owner = `${randomUUID()}.json`;
  const prepared = `${path}.${randomUUID()}`;
  mkdirSync(prepared);
  writeFileSync(resolve(prepared, owner), JSON.stringify({ pid: process.pid }));
  const started = Date.now();
  try {
    while (true) {
      try {
        renameSync(prepared, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") {
          throw error;
        }
        reap(path);
        if (Date.now() - started > 30_000) {
          throw new Error(
            `capn workspace is busy: ${path}; another process still holds its lock`
          );
        }
        await setTimeout(20);
      }
    }
    try {
      return await action();
    } finally {
      release(path, owner);
    }
  } finally {
    release(prepared, owner);
  }
}
