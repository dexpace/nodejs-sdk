// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/check-fences.mjs
//
// Typechecks the code fences in the documentation against the BUILT packages.
//
//   bun run build && node .claude/skills/housekeeping/check-fences.mjs
//
// The harvested styleguide asks for exactly this — "the documentation build typechecks the
// code fences inside `@example` tags so worked examples cannot silently drift out of sync
// with the API" (docs/knowledge/harvested/documentation.md:50). Nothing else in this
// repository does it: `api:ci` diffs signatures, `verify:consumer-types` compiles the
// emitted `.d.ts`, and neither reads a README. Two shipped transport READMEs opened with a
// sample that had not compiled since Phase 10 (docs/open-items.md U8), which is why this
// exists.
//
// Two kinds of fence are skipped, and the rules are deliberate:
//
//   - **No `@dexpace/*` specifier** — an illustrative fragment: an interface quote, an
//     expression sample. Compiling it in isolation would prove nothing.
//   - **A relative import** — package-local. It only means anything from inside the
//     package it documents, and cannot resolve from a scratch directory.
//
// The first rule tests for the SPECIFIER, not for an `import` line carrying it. A
// single-line `/^import .*'@dexpace\//m` silently reclassified every fence whose import
// list wraps — which was the documentation's four largest worked examples, `write-a-transport.md`,
// `errors.md`, `write-a-paging-strategy.md` and `write-a-serde.md`. Breaking one of them
// still printed PASS.
//
// An import of an uninstalled OPTIONAL peer (`pino`, `debug`) or of a schema library named
// only as an illustration (`zod`) is reported and not counted as a failure: those packages
// are legitimately absent from this workspace.

import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertWritable} from './guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

const SCRATCH = '.housekeeping-fences';
const FENCE = /```(?:typescript|ts)\n([\s\S]*?)```/g;
const ABSENT_MODULES = ['pino', 'debug', 'zod'];

const DEFAULT_FILES = () =>
  execFileSync(
    'git',
    [
      'ls-files',
      '--',
      'README.md',
      'docs/sdk-documentation/*.md',
      'packages/*/README.md',
    ],
    {cwd: ROOT, encoding: 'utf8'},
  )
    .trim()
    .split('\n')
    .filter(Boolean);

/**
 * Extracts the runnable fences into `dir`, returning one entry per written file.
 *
 * `root` is a parameter so `check-fences.test.mjs` can drive this over a throwaway tree
 * rather than over the repository it is testing.
 */
export function extract(dir, files, root = ROOT) {
  // This function opens by DELETING `dir`. `main` only ever passes the module constant, so
  // no caller reaches it with anything else today — but an exported function whose first
  // act is a recursive remove must not be one guard away from eating a normative tree, and
  // the tests below pass a `dir` of their own.
  assertWritable(dir, root);
  rmSync(join(root, dir), {recursive: true, force: true});
  mkdirSync(join(root, dir), {recursive: true});

  const written = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    let index = 0;
    for (const match of text.matchAll(FENCE)) {
      index++;
      const code = match[1];
      if (!/'@dexpace\//.test(code)) continue;
      if (/from '\.\.?\//.test(code)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      const name =
        `${basename(dirname(file))}-${basename(file, '.md')}-${index}.ts`
          .replace(/[^\w.-]/g, '_')
          .replace(/^[.-]+/, 'root-');
      writeFileSync(join(root, dir, name), code);
      written.push({
        name,
        from: `${file}:${line}`,
        importLines: importLines(code),
      });
    }
  }

  writeFileSync(
    join(root, dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.AsyncIterable'],
          strict: true,
          // On for the IMPORT diagnostics only — see `importDiagnostics`. An unused import
          // in a worked example is a defect: it tells a reader they need a symbol they do
          // not. An unused *local* is not: `const body = serdeBody(value, serde);` exists
          // to show the shape of what comes back, and has nothing to do afterwards.
          noUnusedLocals: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        include: ['*.ts'],
      },
      null,
      1,
    )}\n`,
  );
  return written;
}

/** `1`-based line numbers of every physical line inside an import declaration. */
function importLines(code) {
  const lines = code.split('\n');
  const inside = new Set();
  let open = false;
  for (const [index, line] of lines.entries()) {
    if (open || /^\s*import\b/.test(line)) {
      inside.add(index + 1);
      // A declaration ends at the `;`, or at the `from '…'` for a braceless one.
      open = !/;\s*$/.test(line);
    }
  }
  return inside;
}

const UNUSED = /^(.+?)\((\d+),\d+\): error TS(6133|6192):/;

/**
 * Is this diagnostic about an unused LOCAL rather than an unused import?
 *
 * `noUnusedLocals` covers both and TypeScript has no flag that separates them, so the split
 * happens here: TS6192 is always an import declaration; TS6133 is one only when the symbol
 * it names sits on a line inside one.
 */
function isUnusedLocal(line, written) {
  const match = UNUSED.exec(line);
  if (match === null) return false;
  if (match[3] === '6192') return false; // "All imports in import declaration are unused"
  const entry = written.find(w => match[1].endsWith(w.name));
  if (entry === undefined) return false;
  return !entry.importLines.has(Number(match[2]));
}

function main() {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const targets = files.length > 0 ? files : DEFAULT_FILES();

  // `finally`, so an interrupted or throwing run does not leave `.housekeeping-fences/`
  // behind. `.gitignore` hides it either way, which is why this ranks where it does.
  try {
    const written = extract(SCRATCH, targets);

    let output = '';
    try {
      execFileSync(
        './node_modules/.bin/tsc',
        ['-p', `${SCRATCH}/tsconfig.json`],
        {
          cwd: ROOT,
          encoding: 'utf8',
        },
      );
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }

    const lines = output.split('\n').filter(Boolean);
    const absent = lines.filter(l =>
      ABSENT_MODULES.some(m => l.includes(`TS2307: Cannot find module '${m}'`)),
    );
    const unusedLocal = lines.filter(l => isUnusedLocal(l, written));
    const real = lines.filter(
      l => !absent.includes(l) && !unusedLocal.includes(l),
    );

    process.stdout.write(
      `${String(written.length)} runnable fence(s) from ${String(targets.length)} file(s)\n`,
    );
    for (const line of real) process.stdout.write(`${line}\n`);
    if (absent.length > 0) {
      process.stdout.write(
        `\n${String(absent.length)} import(s) of a package absent from this workspace, ` +
          `ignored: ${ABSENT_MODULES.join(', ')}\n`,
      );
    }
    if (unusedLocal.length > 0) {
      process.stdout.write(
        `${String(unusedLocal.length)} unused local(s), ignored: a worked example may bind a ` +
          'value to show its shape. Unused IMPORTS are still failures.\n',
      );
    }

    if (real.length > 0) {
      process.stdout.write('\nFENCE CHECK: FAIL\n');
      return 1;
    }
    process.stdout.write('\nFENCE CHECK: PASS\n');
    return 0;
  } finally {
    rmSync(join(ROOT, SCRATCH), {recursive: true, force: true});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
