#!/usr/bin/env node
// Seeds public.words from supabase/seed/new_spa.csv.
//
//   npm run seed                  local stack (`supabase start`)
//   npm run seed -- --dry-run     only write supabase/.temp/import_words.sql
//   npm run seed:remote           linked project (`--target linked`)
//
// --overwrite and --prune are passed through to
// scripts/generate_words_import_sql.py; without them the import only adds
// new ranks and fills empty fields. See supabase/README.md.
//
// The target and the production confirmation are command-line flags only,
// never environment variables, so nothing left exported in a shell can turn
// a later run into a remote one. The linked target refuses the production
// project unless --confirm-project-ref names that project's ref.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const CSV_PATH = "supabase/seed/new_spa.csv";
const SQL_PATH = "supabase/.temp/import_words.sql";
const PROJECT_REF_PATH = "supabase/.temp/project-ref";

// Hosted project behind languageacquisition.net. Keep in sync if it moves.
const PRODUCTION_PROJECT_REFS = new Set(["xjlowdivepjtukzzehki"]);

function fail(message) {
  console.error(`seed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    target: "local",
    confirmProjectRef: null,
    dryRun: false,
    generatorFlags: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") opts.target = argv[++i];
    else if (arg.startsWith("--target=")) opts.target = arg.slice("--target=".length);
    else if (arg === "--confirm-project-ref") opts.confirmProjectRef = argv[++i];
    else if (arg.startsWith("--confirm-project-ref=")) {
      opts.confirmProjectRef = arg.slice("--confirm-project-ref=".length);
    } else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--overwrite" || arg === "--prune") opts.generatorFlags.push(arg);
    else fail(`unknown argument ${arg}`);
  }
  if (opts.target !== "local" && opts.target !== "linked") {
    fail(`target must be "local" or "linked", got "${opts.target}"`);
  }
  return opts;
}

// Same precedence as the supabase CLI: SUPABASE_PROJECT_ID, then the link file.
function resolveLinkedRef() {
  const fromEnv = process.env.SUPABASE_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  const refFile = join(repoRoot, PROJECT_REF_PATH);
  if (!existsSync(refFile)) {
    fail(`no linked project (${PROJECT_REF_PATH} is missing). Run \`supabase link\` first.`);
  }
  const ref = readFileSync(refFile, "utf8").trim();
  if (!ref) fail(`${PROJECT_REF_PATH} is empty. Run \`supabase link\` first.`);
  return ref;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) {
    fail(result.error.code === "ENOENT" ? `${command} not found on PATH` : result.error.message);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const opts = parseArgs(process.argv.slice(2));

let linkedRef = null;
if (opts.target === "linked" && !opts.dryRun) {
  linkedRef = resolveLinkedRef();
  if (PRODUCTION_PROJECT_REFS.has(linkedRef) && opts.confirmProjectRef !== linkedRef) {
    fail(
      [
        `refusing to seed ${linkedRef}: it is the production project and holds learner data.`,
        `Back it up and read the SQL from \`npm run seed -- --dry-run\` first.`,
        `To proceed, pass --confirm-project-ref set to that ref.`,
      ].join("\n"),
    );
  }
}

if (!existsSync(join(repoRoot, CSV_PATH))) {
  fail(`${CSV_PATH} not found. It is gitignored; copy the word list there first.`);
}

run("python3", [
  "scripts/generate_words_import_sql.py",
  ...opts.generatorFlags,
  CSV_PATH,
  SQL_PATH,
]);

if (opts.dryRun) {
  console.log(`Dry run: nothing applied. Review ${SQL_PATH}.`);
  process.exit(0);
}

if (opts.target === "local") {
  console.log("Applying to the local stack (supabase db query --local).");
  run("supabase", ["db", "query", "--local", "-f", SQL_PATH]);
} else {
  console.log(`Applying to linked project ${linkedRef}.`);
  run("supabase", ["db", "query", "--linked", "--project-ref", linkedRef, "-f", SQL_PATH]);
}
