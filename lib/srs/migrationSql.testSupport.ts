/**
 * Test support for SQL-parsing parity tests. Not imported by app code (it
 * reads the filesystem).
 *
 * Parity tests must check the definition that actually runs in production:
 * the LAST migration (sorted by filename, which is the order Supabase applies
 * them) that creates the function. Hard-coding a migration file silently
 * keeps testing a superseded body once a later migration redefines it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

export type MigrationFile = { name: string; sql: string };

export function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8"),
    }));
}

export function stripSqlLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function createFunctionPattern(functionName: string): RegExp {
  return new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${functionName}\\s*\\(`,
    "i",
  );
}

/** Latest migration whose (comment-stripped) SQL creates public.<functionName>. */
export function findLatestMigrationDefining(functionName: string): MigrationFile {
  const pattern = createFunctionPattern(functionName);
  const defining = readMigrations().filter((m) =>
    pattern.test(stripSqlLineComments(m.sql)),
  );
  const latest = defining[defining.length - 1];
  if (!latest) {
    throw new Error(`No migration defines public.${functionName}`);
  }
  return latest;
}

/**
 * The CREATE FUNCTION statement for public.<functionName> in `sql`, from the
 * CREATE keyword through the closing `$$;` of its body, with `--` comments
 * removed so assertions only ever match executable SQL. If the file defines
 * the function more than once, the last definition wins (as when applied).
 */
export function extractFunctionDefinition(rawSql: string, functionName: string): string {
  const sql = stripSqlLineComments(rawSql);
  const pattern = new RegExp(createFunctionPattern(functionName).source, "gi");
  let start = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    start = match.index;
  }
  if (start === -1) {
    throw new Error(`public.${functionName} is not defined in the given SQL`);
  }
  const end = sql.indexOf("\n$$;", start);
  if (end === -1) {
    throw new Error(`Could not find the end of public.${functionName}`);
  }
  return sql.slice(start, end + "\n$$;".length);
}

/** Live definition of public.<functionName> plus the migration it came from. */
export function getLiveFunctionDefinition(functionName: string): {
  migration: string;
  definition: string;
} {
  const latest = findLatestMigrationDefining(functionName);
  return {
    migration: latest.name,
    definition: extractFunctionDefinition(latest.sql, functionName),
  };
}
