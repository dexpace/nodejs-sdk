// SPDX-License-Identifier: MIT
// scripts/verify-import-cycles.mjs
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * `docs/knowledge/harvested/module-organization.md:20` treats an import cycle as a bug rather than a style nit,
 * and `:22` requires it be gated in CI. Until 2026-09-04 neither `madge --circular` nor
 * `eslint-plugin-import/no-cycle` appeared anywhere in this repository, so twelve-plus source folders per
 * package relied on review alone (`docs/work/mvp/2026-09-04-open-items-dissolution.md` K12).
 *
 * Hand-written rather than `madge` for the reason every other gate here is: `verify:seam-1` asserts zero runtime
 * dependencies per package and this repo keeps its gates dependency-free, so a gate that needs an install is a
 * gate that can be skipped. The graph this walks is small — relative specifiers inside one package's `src/` —
 * and the whole traversal is a depth-first search with a colour map.
 *
 * **Type-only edges count.** `import type {X} from './y.js'` is erased at runtime and cannot deadlock a module
 * initialization, but a type cycle is still the design smell the requirement is about, and `verbatimModuleSyntax`
 * means the distinction is spelled consistently enough to make excluding them a deliberate choice rather than an
 * accident. If a type-only cycle is ever judged acceptable, exclude it here with a stated reason — do not widen
 * the whole gate.
 *
 * Test files are skipped: a `*.test.ts` is a leaf nothing imports, and a test reaching sideways for a fixture is
 * not the failure this guards.
 */

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGES = join(ROOT, 'packages');

/** Matches the specifier of a static import/export, a side-effect import, or a dynamic import. */
const SPECIFIER_PATTERNS = [
  /(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFilesUnder(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The relative specifiers `file` imports, resolved to absolute `.ts` paths.
 *
 * ESM-only/NodeNext means every relative specifier carries a `.js` extension even in `.ts` source, so the
 * mapping back is `.js` → `.ts`. A specifier that does not resolve to a file on disk is skipped rather than
 * reported: `tsc` already fails on an unresolvable import, and duplicating that check here would make this gate
 * fail for a reason that has nothing to do with cycles.
 */
function edgesFrom(file) {
  const text = readFileSync(file, 'utf8');
  const edges = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
      try {
        if (statSync(target).isFile()) edges.add(target);
      } catch {
        // Unresolvable here is `tsc`'s to report, not this gate's. See the doc comment above.
      }
    }
  }
  return [...edges];
}

/**
 * Depth-first search reporting the first cycle it closes, as the list of files that form it with the
 * entry point repeated at the end. `null` when the graph is acyclic.
 *
 * `edgesOf` is injectable so the gate's own suite can drive a synthetic graph without writing files —
 * the same shape `verify-sse-37.mjs` uses for its scanner.
 *
 * @param {string[]} files
 * @param {(file: string) => string[]} [edgesOf]
 * @returns {string[] | null}
 */
export function findCycle(files, edgesOf = edgesFrom) {
  const graph = new Map(files.map(file => [file, edgesOf(file)]));
  const state = new Map(); // undefined = unvisited, 1 = on the current path, 2 = finished
  const path = [];

  function visit(file) {
    state.set(file, 1);
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 1)
        return [...path.slice(path.indexOf(next)), next];
      if (state.get(next) === undefined) {
        const found = visit(next);
        if (found !== null) return found;
      }
    }
    path.pop();
    state.set(file, 2);
    return null;
  }

  for (const file of files) {
    if (state.get(file) === undefined) {
      const found = visit(file);
      if (found !== null) return found;
    }
  }
  return null;
}

const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  const failures = [];

  let scanned = 0;
  for (const pkg of readdirSync(PACKAGES).sort()) {
    const src = join(PACKAGES, pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    const files = sourceFilesUnder(src);
    scanned += files.length;
    const cycle = findCycle(files);
    if (cycle !== null) {
      failures.push(
        `@dexpace/${pkg}: import cycle\n    ${cycle
          .map(file => relative(ROOT, file))
          .join('\n -> ')}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('verify:import-cycles FAILED\n');
    for (const failure of failures) console.error(`  ${failure}\n`);
    console.error(
      'An import cycle is a bug, not a style nit (docs/knowledge/harvested/module-organization.md:20).\n' +
        'Break it by moving the shared declaration into a module both sides can import, not by making one\n' +
        'edge type-only -- a type cycle still fails this gate, deliberately.',
    );
    process.exit(1);
  }

  console.log(
    `verify:import-cycles OK -- no cycles across ${String(scanned)} source file(s)`,
  );
}
