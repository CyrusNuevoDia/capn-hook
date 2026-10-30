import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function atomicWrite(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, body, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function fail(message: string): never {
  throw new Error(message.trimEnd());
}
