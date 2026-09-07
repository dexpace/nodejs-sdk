// SPDX-License-Identifier: MIT
// scripts/verify-sse-37.mjs
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const FORBIDDEN = [
  /^\.\.\/serde\//,
  /^\.\.\/seams\/serde\.js$/,
  /^@dexpace\/codec-json/,
];

const IMPORT_PATTERNS = [
  // Standard static import/export: import ... from '...' or export ... from '...'
  /(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
  // Side-effect import: import '...'
  /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g,
  // Dynamic import: import('...')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * SSE-38: reconnection and last-event-id continuity are the caller's responsibility. Core must contain no path
 * that re-opens a connection or writes a `Last-Event-ID` header. Checked as a literal scan because the failure
 * mode is somebody "helpfully" adding one — there is no type or import that would give it away.
 *
 * Scanned against **code with comments stripped**. The requirement forbids the code path, not the documentation
 * of its absence — and "this subsystem never reconnects; that is the caller's job" is the single most likely
 * sentence to appear in a TSDoc under `src/sse/`. A gate that fails on its own requirement's explanation is a
 * gate the next person deletes instead of the comment, so it has to tolerate prose to be worth installing.
 */
const RECONNECT_MARKERS = [/Last-Event-ID/i, /\breconnect/i, /\bfetch\s*\(/];

/** Blank out block and line comments, preserving line count so reported positions stay meaningful. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length));
}

/** Recursively collect all .ts files in dir. */
function collectFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...collectFiles(fullPath));
    } else if (name.endsWith('.ts')) {
      entries.push(fullPath);
    }
  }
  return entries;
}

/**
 * SSE-37: core SSE parsing and streaming must carry no serialization dependency.
 *
 * @param {string} [dir] directory to scan
 * @param {{file: string, source: string}[]} [injected] in-memory files, for testing the detector itself
 * @returns {{file: string, specifier: string}[]}
 */
export function findForbiddenSerdeImports(dir, injected) {
  const scanDir =
    dir ?? fileURLToPath(new URL('../packages/core/src/sse', import.meta.url));

  const files =
    injected ??
    collectFiles(scanDir).map(fullPath => ({
      file: relative(scanDir, fullPath),
      source: readFileSync(fullPath, 'utf8'),
    }));

  const violations = [];
  for (const {file, source} of files) {
    const code = stripComments(source);

    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of code.matchAll(pattern)) {
        const specifier = match[1];
        if (FORBIDDEN.some(forbidden => forbidden.test(specifier))) {
          violations.push({file, specifier});
        }
      }
    }

    // Reconnect markers are checked on shipped source only. A test double is entitled to say `fetch(` or name a
    // reconnect scenario it is asserting the absence of; SSE-38 constrains what core *does*, not what the suite
    // describes.
    if (file.endsWith('.test.ts')) continue;
    for (const marker of RECONNECT_MARKERS) {
      if (marker.test(code)) {
        violations.push({
          file,
          specifier: `SSE-38 reconnect marker ${String(marker)}`,
        });
      }
    }
  }
  return violations;
}

const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  const violations = findForbiddenSerdeImports();
  if (violations.length > 0) {
    for (const {file, specifier} of violations) {
      console.error(`SSE-37 violation: ${file} imports ${specifier}`);
    }
    console.error(
      'Core SSE parsing and streaming MUST carry no serialization dependency (SSE-37) and no reconnection or Last-Event-ID path (SSE-38). Move conversions into a caller-supplied mapper; leave reconnection to the caller.',
    );
    process.exit(1);
  }
  console.log(
    'SSE-37/SSE-38 OK: no serde imports and no reconnect path under packages/core/src/sse',
  );
}
