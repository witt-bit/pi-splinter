// ---------------------------------------------------------------------------
// Runs every test file in its own process and aggregates the exit codes.
// Sequential on purpose: each file bundles the extension, and a later suite must
// not start while an earlier one is still staging files in the repo.
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();

const failed = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [resolve(here, file)], { stdio: "inherit" });
  if (result.status !== 0) failed.push(file);
}

if (failed.length > 0) {
  console.log(`\n失败的测试文件: ${failed.join(", ")}`);
  process.exit(1);
}
