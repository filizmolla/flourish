import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always run against the isolated flourish_test database (.env.test), never dev data.
// Set here rather than via dotenv in the tests so the env is in place before
// src/prisma.ts reads DATABASE_URL at import time.
const testEnv = parse(readFileSync(".env.test"));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: testEnv,
    // Test files share one database; running them one at a time keeps
    // cleanup in one file from racing another file's assertions.
    fileParallelism: false,
  },
});
