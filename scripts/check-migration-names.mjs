#!/usr/bin/env node
// Migration filename checker. Run with: `node scripts/check-migration-names.mjs`.
//
// The Supabase CLI keys migrations on the leading version number, so a stray
// copy such as "20260516170000_foo 2.sql" (a Finder duplicate) shares its
// version with the original and breaks the next `supabase db push`. This
// fails when any file in supabase/migrations:
//   - does not match ^\d{14}_[a-z0-9_]+\.sql$, or
//   - repeats a 14-digit version prefix used by another file.
// Dotfiles (e.g. .DS_Store) are ignored. An optional directory argument
// overrides the default, for testing.
//
// Exit codes:
//   0 — all names valid and versions unique
//   1 — one or more problems (CI should fail)

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = process.argv[2]
  ? resolve(process.argv[2])
  : join(repoRoot, "supabase", "migrations");

const NAME_PATTERN = /^\d{14}_[a-z0-9_]+\.sql$/;
const VERSION_PATTERN = /^(\d{14})(?!\d)/;

const problems = [];
const filesByVersion = new Map();

const entries = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

for (const entry of entries) {
  if (statSync(join(migrationsDir, entry)).isDirectory()) {
    problems.push(`${entry}: unexpected directory`);
    continue;
  }
  if (!NAME_PATTERN.test(entry)) {
    problems.push(
      `${JSON.stringify(entry)}: name must match ${NAME_PATTERN.source}`,
    );
  }
  const version = VERSION_PATTERN.exec(entry)?.[1];
  if (version) {
    const files = filesByVersion.get(version) ?? [];
    files.push(entry);
    filesByVersion.set(version, files);
  }
}

for (const [version, files] of filesByVersion) {
  if (files.length > 1) {
    problems.push(
      `version ${version} used by ${files.length} files: ${files
        .map((file) => JSON.stringify(file))
        .join(", ")}`,
    );
  }
}

const relativeDir = relative(repoRoot, migrationsDir);
const label =
  relativeDir && !relativeDir.startsWith("..") ? relativeDir : migrationsDir;

if (problems.length === 0) {
  console.log(`check-migration-names — ${entries.length} migrations in ${label}, no problems`);
  process.exit(0);
}

console.log(`check-migration-names — ${problems.length} problem(s) in ${label}:\n`);
for (const problem of problems) {
  console.log(`  ${problem}`);
}
process.exit(1);
