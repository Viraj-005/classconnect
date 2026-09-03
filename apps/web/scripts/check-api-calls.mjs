/*
  Verify every API client method a screen calls actually exists.

  This exists because two of them did not. `studentApi.quizzes` and
  `teacherApi.quizzes` were used by three screens while the client only
  had the other methods. Neither the build nor ESLint can see it: the
  object is defined, so `no-undef` is satisfied, and a missing property
  is just `undefined` until something calls it.

  The failure modes were both bad. The student pages threw
  "studentApi.quizzes is not a function" and showed an error state. The
  teacher analytics page swallowed it and rendered an empty quiz table,
  which reads as "no quizzes exist" rather than "this did not load".

  Deliberately a grep rather than a real module graph. It has to run in
  a second, it has no dependencies, and it catches the whole class of
  mistake. A false positive from a name in a comment is cheap; a missed
  method is not.

    node scripts/check-api-calls.mjs
*/

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const srcDir = join(root, "src");
const clientPath = join(srcDir, "lib", "api.js");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const client = readFileSync(clientPath, "utf8");

/* Pull the method names out of each exported `xxxApi = { ... }` block. */
const exported = new Map();
for (const match of client.matchAll(/export const (\w+Api|auth)\s*=\s*\{/g)) {
  const name = match[1];
  let depth = 0;
  let i = match.index + match[0].length - 1;
  const start = i;
  do {
    if (client[i] === "{") depth++;
    else if (client[i] === "}") depth--;
    i++;
  } while (depth > 0 && i < client.length);

  const body = client.slice(start, i);
  /*
    Anchored to the start of a line. Matching anywhere would also pick
    up helper calls inside template literals, for example the `qs(...)`
    in a query string, and list them as available methods.
  */
  const methods = new Set(
    [...body.matchAll(/^\s{2,}(?:async\s+)?(\w+)\s*[:(]/gm)].map((m) => m[1]),
  );
  exported.set(name, methods);
}

const files = walk(srcDir).filter(
  (f) => (f.endsWith(".jsx") || f.endsWith(".js")) && f !== clientPath,
);

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, idx) => {
    for (const m of line.matchAll(/\b(\w+Api|auth)\.(\w+)\s*\(/g)) {
      const [, obj, method] = m;
      const known = exported.get(obj);
      if (!known) continue; // Not one of ours.
      if (!known.has(method)) {
        problems.push({
          file: relative(root, file),
          line: idx + 1,
          call: `${obj}.${method}()`,
          available: [...known].sort().join(", "),
        });
      }
    }
  });
}

if (problems.length === 0) {
  const total = [...exported.values()].reduce((n, s) => n + s.size, 0);
  console.log(
    `api calls ok: every call resolves against ${exported.size} clients (${total} methods)`,
  );
  process.exit(0);
}

console.error(`\n${problems.length} API call(s) reference a method that does not exist:\n`);
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  ${p.call}`);
  console.error(`    available: ${p.available}\n`);
}
process.exit(1);
