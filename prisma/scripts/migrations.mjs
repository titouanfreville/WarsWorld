/**
 * Migration tooling for this repo's schema workflow.
 *
 * The workflow is: iterate locally with `prisma db push` (no files, no history), then — once the
 * shape has settled — capture the accumulated change as ONE migration. `prisma migrate dev` cannot
 * do that: your pushed DB always contains changes the migration history doesn't know about, which it
 * reads as drift and offers to fix by RESETTING the database. So instead we compute the SQL by
 * diffing migration history against schema.prisma (via a scratch "shadow" database), then tell
 * Prisma the migration is already applied — because `db push` applied it hours ago.
 *
 *   node prisma/scripts/migrations.mjs new <name>   → generate + mark applied
 *   node prisma/scripts/migrations.mjs check        → assert migrations reproduce schema.prisma
 *
 * `check` is the CI guard for the multi-developer case: if two people generate migrations from
 * different baselines and one merges first, the survivor's SQL can stop reproducing schema.prisma.
 * That failure is otherwise SILENT until a fresh environment comes up different from production.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(repoRoot, "prisma", "migrations");
const schemaPath = join(repoRoot, "prisma", "schema.prisma");

/**
 * Read .env the way Prisma does — including `${VAR}` expansion, which `node --env-file` does NOT do.
 * DATABASE_URL and SHADOW_DATABASE_URL both interpolate ${PGPASSWORD}, so without this they'd be
 * passed to Prisma with the placeholder intact and the connection would fail confusingly.
 *
 * The real environment is the base layer and `.env` is overlaid on top when present, so this works
 * unchanged in CI — where `.env` is gitignored and never exists, and the values arrive as real
 * environment variables instead.
 */
const loadEnv = () => {
  const envPath = join(repoRoot, ".env");
  const values = { ...process.env };

  if (!existsSync(envPath)) {
    return values;
  }

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);

    if (match === null || line.trimStart().startsWith("#")) {
      continue;
    }

    const raw = match[2].trim().replace(/^["']|["']$/g, "");

    // Expand against values seen earlier in the file, then the real environment.
    values[match[1]] = raw.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_, name) => values[name] ?? process.env[name] ?? "",
    );
  }

  return values;
};

const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

/** Run the Prisma CLI, inheriting stdio unless we need to capture stdout. */
const prisma = (args, { capture = false } = {}) =>
  spawnSync("npx", ["prisma", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });

const shadowUrl = () => {
  const url = loadEnv().SHADOW_DATABASE_URL;

  if (url === undefined || url === "") {
    fail(
      "SHADOW_DATABASE_URL is not set in .env — see .env.example.\n" +
        "  Create the database once with: npm run prisma:shadow-init",
    );
  }

  return url;
};

const diffArgs = (url) => [
  "migrate",
  "diff",
  "--from-migrations",
  "prisma/migrations",
  "--to-schema-datamodel",
  schemaPath,
  "--shadow-database-url",
  url,
];

/** `new <name>` — capture everything `db push` has applied since the last migration. */
const createMigration = (name) => {
  if (name === undefined || !/^[a-z0-9_]+$/.test(name)) {
    fail("Usage: npm run prisma:migrate:new -- <lower_snake_case_name>");
  }

  const url = shadowUrl();
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const dir = join(migrationsDir, `${stamp}_${name}`);

  const result = prisma([...diffArgs(url), "--script"], { capture: true });

  if (result.status !== 0) {
    fail(`prisma migrate diff failed:\n${result.stderr ?? ""}`);
  }

  const sql = result.stdout.trim();

  // Prisma emits this comment (and nothing else) when the datamodel already matches history.
  if (sql === "" || sql.startsWith("-- This is an empty migration")) {
    console.log("\nNothing to migrate — migration history already matches schema.prisma.\n");

    return;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration.sql"), `${sql}\n`);

  // Your dev DB already has these changes (db push applied them), so record the migration as
  // applied instead of running it — running it would fail against columns that already exist.
  const resolved = prisma(["migrate", "resolve", "--applied", `${stamp}_${name}`]);

  if (resolved.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    fail("migrate resolve failed — removed the generated folder so nothing half-registered.");
  }

  console.log(`\n✔ Created prisma/migrations/${stamp}_${name} and marked it applied.`);
  console.log("  Review the SQL before committing — a diff can express a rename as drop+add.\n");
};

/** `check` — do the migrations, replayed from scratch, reproduce schema.prisma exactly? */
const checkMigrations = () => {
  const result = prisma([...diffArgs(shadowUrl()), "--exit-code"], { capture: true });

  // Prisma's contract: 0 = no difference, 2 = difference found, anything else = it broke.
  if (result.status === 0) {
    console.log("\n✔ Migrations reproduce schema.prisma exactly.\n");

    return;
  }

  if (result.status === 2) {
    console.error(`\n${result.stdout ?? ""}`);
    fail(
      "Migrations do NOT reproduce schema.prisma.\n" +
        "  Usually: schema.prisma was `db push`ed but never captured as a migration, or two\n" +
        "  branches generated migrations from different baselines. Rebase on main, then run:\n" +
        "    npm run prisma:migrate:new -- <name>",
    );
  }

  fail(`prisma migrate diff failed:\n${result.stderr ?? ""}`);
};

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "new":
    createMigration(argument);
    break;
  case "check":
    checkMigrations();
    break;
  default:
    fail("Usage: node prisma/scripts/migrations.mjs <new <name> | check>");
}
