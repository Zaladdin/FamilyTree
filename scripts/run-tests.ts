import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertTestDatabaseUrl, UNIT_DATABASE_URL } from "./test-environment";

const mode = process.argv[2] ?? "unit";
if (!["unit", "integration"].includes(mode) || process.argv.length > 3) {
  console.error("Usage: npm test | npm run test:integration");
  process.exit(1);
}

let databaseUrl: string;
try {
  databaseUrl = mode === "integration"
    ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)
    : UNIT_DATABASE_URL;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unsafe test database configuration.");
  process.exit(1);
}

const projectRoot = process.cwd();
if (!existsSync(path.join(projectRoot, "node_modules", ".prisma", "client", "index.js"))) {
  console.error("Prisma Client is missing. Run npm run prisma:generate once before testing.");
  process.exit(1);
}
const testDirectory = path.join(projectRoot, "tests", ...(mode === "integration" ? ["integration"] : []));
// Enumerate exactly one directory: the default command never discovers integration tests.
const testFiles = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join(testDirectory, name));
if (!testFiles.length) throw new Error("No test files found.");

const testEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
if (mode === "unit") {
  testEnv.DATABASE_URL = databaseUrl;
  // Match Next.js's automatic JSX runtime for server-rendered component tests.
  testEnv.TSX_TSCONFIG_PATH = path.join(projectRoot, "tests", "tsconfig.json");
  delete testEnv.TEST_DATABASE_URL;
} else {
  // Preserve the primary URL until each integration file's own fail-closed guard
  // checks it, then that helper switches Prisma to the explicit test database.
  testEnv.TEST_DATABASE_URL = databaseUrl;
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: testEnv,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error("Unable to start test process:", result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Node isolates test files in child processes; media tests can safely change their own cwd.
run(["--import", "tsx", "--test", "--test-concurrency=1", ...testFiles]);
