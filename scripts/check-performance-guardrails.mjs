#!/usr/bin/env node
// Permanent performance guardrail checker for this repo.
//
// Run with: `npm run perf:check`.
// See docs/performance-guardrails.md for the rules this enforces.
//
// Each rule is intentionally a simple regex pass. False positives are
// acceptable — the check exists to *remind* the next developer, not to
// replace code review. Silence a specific line by adding a trailing
// comment containing `perf-ok:` with a short reason, e.g.
//   router.refresh(); // perf-ok: required because <reason>
//
// Exit codes:
//   0 — no violations
//   1 — one or more violations (CI should fail)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Files on the user's critical path. Edits to these must clear the
// hot-path checklist. Keep this list in sync with docs/performance-guardrails.md.
const HOT_PATH_FILES = [
  "app/actions/srs.ts",
  "app/reader/actions.ts",
  "app/today/page.tsx",
  "components/srs/TodaySession.tsx",
  "components/reader/ReaderSession.tsx",
  "components/reader/ReaderNextStepCard.tsx",
  "components/listening/ListeningPlayer.tsx",
];

// Directories to scan for broader rules.
const SCAN_DIRS = ["app", "components", "lib"];
const SCAN_EXTS = new Set([".ts", ".tsx"]);

/** @type {{ file: string; line: number; rule: string; message: string }[]} */
const violations = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (SCAN_EXTS.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

function readLines(absPath) {
  return readFileSync(absPath, "utf8").split("\n");
}

function hasSilencer(line) {
  return /perf-ok:/.test(line);
}

function report(file, line, rule, message) {
  violations.push({ file: relative(repoRoot, file), line, rule, message });
}

// ---------------------------------------------------------------------------
// Rule 1: router.refresh() after router.push() in the same function.
//
// The push already triggers an RSC render; a refresh doubles it. We flag
// any router.refresh() that appears within ~10 lines after a router.push()
// in the same file. Silence with a `perf-ok:` comment on the refresh line.
// ---------------------------------------------------------------------------
function ruleRefreshAfterPush(file, lines) {
  let lastPushLine = -100;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/router\.push\(/.test(l)) lastPushLine = i;
    if (/router\.refresh\(\)/.test(l) && !hasSilencer(l)) {
      if (i - lastPushLine <= 10) {
        report(
          file,
          i + 1,
          "refresh-after-push",
          "router.refresh() within 10 lines of router.push() — likely duplicate RSC render. " +
            "If required, add `// perf-ok: <reason>` on this line.",
        );
      } else {
        // Also flag standalone refresh() in hot-path client components.
        const rel = relative(repoRoot, file);
        if (HOT_PATH_FILES.includes(rel)) {
          report(
            file,
            i + 1,
            "refresh-on-hot-path",
            "router.refresh() on a hot-path component. Prefer optimistic local state. " +
              "If required, add `// perf-ok: <reason>` on this line.",
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2: revalidatePath fan-out in a single function.
//
// More than 3 distinct revalidatePath calls within a 15-line window is
// almost always over-broad from a single action. A 15-line window stays
// inside one function body so we don't flag two adjacent 2-call actions.
// Silence individual lines with `perf-ok:`.
// ---------------------------------------------------------------------------
function ruleRevalidateFanout(file, lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/revalidatePath\(/.test(lines[i]) && !hasSilencer(lines[i])) {
      hits.push(i);
    }
  }
  for (let i = 0; i < hits.length; i++) {
    const windowHits = hits.filter((h) => h >= hits[i] && h - hits[i] <= 15);
    if (windowHits.length >= 4) {
      report(
        file,
        hits[i] + 1,
        "revalidate-fanout",
        `${windowHits.length} revalidatePath calls within 15 lines. Justify each or narrow the fan-out. ` +
          "Silence with `// perf-ok: <reason>`.",
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 3: direct `supabase.auth.getUser()` in hot action files.
//
// Hot-path files should use getSupabaseServerContextFast (which uses
// getSession). Auth helpers themselves are allowed.
// ---------------------------------------------------------------------------
const AUTH_HELPER_FILES = new Set([
  "lib/supabase/auth.ts",
  "lib/supabase/server.ts",
]);
function ruleDirectGetUser(file, lines) {
  const rel = relative(repoRoot, file);
  if (AUTH_HELPER_FILES.has(rel)) return;
  if (!HOT_PATH_FILES.includes(rel)) return;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/supabase\.auth\.getUser\(\)/.test(l) && !hasSilencer(l)) {
      report(
        file,
        i + 1,
        "direct-get-user",
        "supabase.auth.getUser() on a hot path. Use getSupabaseServerContextFast(). " +
          "If server-side user confirmation is actually required, add `// perf-ok: <reason>`.",
      );
    }
    if (/getSupabaseServerContext\(/.test(l) && !hasSilencer(l)) {
      report(
        file,
        i + 1,
        "slow-auth-context",
        "getSupabaseServerContext() on a hot path. Prefer getSupabaseServerContextFast() " +
          "unless you specifically need a GoTrue round-trip. Silence with `// perf-ok: <reason>`.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 4: debug snapshot / diagnostic calls on production hot paths.
//
// Any `getFlashcardDebugSnapshot` usage must be inside a NODE_ENV gate.
// ---------------------------------------------------------------------------
function ruleDebugOnHotPath(file, lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/getFlashcardDebugSnapshot\(/.test(l) && !hasSilencer(l)) {
      // look back a few lines for a NODE_ENV gate
      const before = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      const isDefinition = /export\s+async\s+function\s+getFlashcardDebugSnapshot/.test(l);
      if (!isDefinition && !/NODE_ENV\s*[!=]==?\s*['"]production['"]/.test(before)) {
        report(
          file,
          i + 1,
          "debug-on-hot-path",
          "getFlashcardDebugSnapshot() called without a NODE_ENV production gate nearby. " +
            "Silence with `// perf-ok: <reason>`.",
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 5: serial awaits of independent DB helpers.
//
// Heuristic: two consecutive lines of the shape `await supabase.from(` /
// `await supabase.rpc(` / `await select*(` without an intervening
// `Promise.all`. Low-precision, but it catches the common mistake.
// ---------------------------------------------------------------------------
function ruleSerialAwaits(file, lines) {
  const rel = relative(repoRoot, file);
  if (!HOT_PATH_FILES.includes(rel)) return;
  const isAwaitFetch = (s) =>
    /^\s*(const|let)\s+[^=]+=\s*await\s+(supabase\.(from|rpc)\(|[a-zA-Z_]+\()/.test(s);
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (isAwaitFetch(a) && isAwaitFetch(b) && !hasSilencer(a) && !hasSilencer(b)) {
      report(
        file,
        i + 1,
        "serial-awaits",
        "Two consecutive `await` fetches on a hot path. If independent, use Promise.all. " +
          "Silence with `// perf-ok: <reason>`.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const allFiles = [];
for (const d of SCAN_DIRS) {
  try {
    allFiles.push(...walk(join(repoRoot, d)));
  } catch {
    // dir may not exist in a subset checkout; skip silently
  }
}

for (const file of allFiles) {
  const lines = readLines(file);
  ruleRefreshAfterPush(file, lines);
  ruleRevalidateFanout(file, lines);
  ruleDirectGetUser(file, lines);
  ruleDebugOnHotPath(file, lines);
  ruleSerialAwaits(file, lines);
}

if (violations.length === 0) {
  console.log("perf:check — no violations");
  process.exit(0);
}

console.log(`perf:check — ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`);
}
console.log("\nSee docs/performance-guardrails.md for each rule.");
console.log("Silence a specific line by appending `// perf-ok: <reason>`.");
process.exit(1);
