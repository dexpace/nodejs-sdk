// SPDX-License-Identifier: MIT
// scripts/verify-test-partition.test.mjs
//
// Tests the GATE, not a copy of its logic. The CLI half spawns the real script against throwaway
// fixture trees and reads its exit code and output, following `verify-seam-1.test.mjs`: a suite that
// only calls the detector passes just as happily when the CLI has stopped exiting non-zero, which is
// the one failure that would leave CI green over a dead gate. The detector half then drives the
// individual checks, which is where the interesting inputs are.
//
// Lives in `scripts/` and runs under `node --test` via `bun run test:scripts`, so `node:fs` and
// `node:child_process` are permitted here -- the zero-`node:` invariant governs `packages/*/src`,
// not build tooling.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {findPartitionViolations} from './verify-test-partition.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = join(repoRoot, 'scripts', 'verify-test-partition.mjs');

// --- the shape of a well-formed repo, as file contents and as a sources object --------------------

const BUNFIG = [
  '[test]',
  'root = "packages"',
  'pathIgnorePatterns = ["tests/node-conformance/**"]',
  'coverage = true',
].join('\n');

const PACKAGE_JSON = JSON.stringify({
  scripts: {
    test: 'bun test ./packages ./tests',
    'test:node': 'node --test tests/node-conformance/*.test.mjs',
  },
});

const ESLINT_CONFIG =
  "export default [{files: ['tests/node-conformance/*.mjs']}];";

// Three, because `run-ci.mjs`'s `--node-floor` leg carries one per version manager.
const RUN_CI = [
  '`mise x node@20.3.0 -- node --test tests/node-conformance/*.test.mjs`,',
  '`fnm exec --using=20.3.0 node --test tests/node-conformance/*.test.mjs`,',
  "`bash -lc 'nvm exec 20.3.0 node --test tests/node-conformance/*.test.mjs'`,",
].join('\n');

const README =
  'Run by `bun run test:node` (`node --test tests/node-conformance/*.test.mjs`).';

const NODE_CASES = [
  'tests/node-conformance/retry.test.mjs',
  'tests/node-conformance/seams.test.mjs',
];

/** A complete, well-formed sources object; overrides replace individual fields. */
function sources(overrides = {}) {
  return {
    bunfig: BUNFIG,
    packageJson: PACKAGE_JSON,
    eslintConfig: ESLINT_CONFIG,
    runCi: RUN_CI,
    readme: README,
    nodeTreeFiles: [...NODE_CASES, 'tests/node-conformance/README.md'],
    bunTreeFiles: ['tests/conformance/xcut/retry-safety.conformance.test.ts'],
    packageFiles: ['packages/core/src/http/headers.test.ts'],
    ...overrides,
  };
}

/** Which checks fired, each once — one drifted string usually trips its check per file. */
const checks = violations => [...new Set(violations.map(v => v.check))].sort();

/** The message a given check produced, so no assertion depends on array position. */
const messageFor = (violations, check) =>
  violations.find(v => v.check === check)?.message ?? '';

// --- the CLI, driven end to end -------------------------------------------------------------------

// Copies the real script into a throwaway tree and runs it there. `REPO_ROOT` is resolved from the
// script's own location, so the copy reads the fixture's files rather than this repository's -- the
// same trick `verify-seam-1.test.mjs` uses, and what makes the failure path reachable through the
// ACTUAL CLI, exit code included.
function runAgainstFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dexpace-partition-'));
  mkdirSync(join(dir, 'scripts'), {recursive: true});
  copyFileSync(script, join(dir, 'scripts', 'verify-test-partition.mjs'));
  for (const [name, contents] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, contents);
  }
  try {
    const result = spawnSync(
      process.execPath,
      [join(dir, 'scripts', 'verify-test-partition.mjs')],
      {encoding: 'utf8'},
    );
    return {status: result.status, output: `${result.stdout}${result.stderr}`};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

/** A fixture tree the gate should accept. */
function cleanFixture(overrides = {}) {
  return {
    'bunfig.toml': BUNFIG,
    'package.json': PACKAGE_JSON,
    'eslint.config.js': ESLINT_CONFIG,
    '.claude/skills/ci-preflight/run-ci.mjs': RUN_CI,
    'tests/node-conformance/README.md': README,
    'tests/node-conformance/retry.test.mjs': '// a case',
    'tests/node-conformance/seams.test.mjs': '// a case',
    'tests/conformance/xcut/a.conformance.test.ts': '// a case',
    'packages/core/src/headers.test.ts': '// a case',
    ...overrides,
  };
}

test('the CLI exits 0 and names all five files when the partition holds', () => {
  const {status, output} = runAgainstFixture(cleanFixture());
  assert.equal(status, 0, output);
  assert.match(output, /test-partition OK:/);
  for (const named of [
    'bunfig.toml',
    'package.json',
    'eslint.config.js',
    'run-ci.mjs',
    'README.md',
  ]) {
    assert.ok(
      output.includes(named),
      `${named} missing from the OK line:\n${output}`,
    );
  }
});

test('the CLI exits 1 and names the failing check when a string has drifted', () => {
  const {status, output} = runAgainstFixture(
    cleanFixture({'bunfig.toml': '[test]\nroot = "packages"\n'}),
  );
  assert.equal(status, 1, `expected a non-zero exit:\n${output}`);
  assert.match(output, /test-partition violation \(check 1\)/);
  assert.match(output, /Change one, then change all of them/);
});

test('the CLI exits 0 on this repository as committed', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

// --- check 1: the bunfig key ----------------------------------------------------------------------

test('the detector fails when bunfig declares testPathIgnorePatterns in place of pathIgnorePatterns', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\ntestPathIgnorePatterns = ["tests/node-conformance/**"]',
    }),
  );
  assert.match(messageFor(found, 1), /declares `testPathIgnorePatterns`/);
});

test('the detector fails when the decoy key is declared alongside the correct one', () => {
  const found = findPartitionViolations(
    sources({bunfig: `${BUNFIG}\ntestPathIgnorePatterns = ["x/**"]`}),
  );
  assert.match(messageFor(found, 1), /declares `testPathIgnorePatterns`/);
});

test('the detector stays quiet when the decoy key is only NAMED in a comment', () => {
  // bunfig.toml must be free to explain the hazard it is configured against. A gate that fails on
  // its own requirement's explanation is a gate the next person deletes instead of the comment.
  const found = findPartitionViolations(
    sources({
      bunfig: `${BUNFIG}\n# The key is not testPathIgnorePatterns; Bun would ignore that in silence.`,
    }),
  );
  assert.deepEqual(found, []);
});

test('the detector fails when the ignore key is absent', () => {
  const found = findPartitionViolations(
    sources({bunfig: '[test]\nroot = "packages"\n'}),
  );
  assert.ok(checks(found).includes(1));
});

test('the detector fails when the ignore key holds an empty array', () => {
  const found = findPartitionViolations(
    sources({bunfig: '[test]\nroot = "packages"\npathIgnorePatterns = []'}),
  );
  assert.ok(checks(found).includes(1));
});

test('the detector fails when the ignore key sits under a section other than [test]', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\n[install]\npathIgnorePatterns = ["tests/node-conformance/**"]',
    }),
  );
  assert.ok(checks(found).includes(1));
});

test('the detector fails when the ignore array is left unterminated', () => {
  // The continuation reader must not swallow the next key's value and report a plausible array.
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = [\n"tests/node-conformance/**"\ncoverage = true',
    }),
  );
  assert.match(messageFor(found, 1), /not terminated/);
});

test('the detector accepts a # inside a quoted pattern rather than truncating the line', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/node-conformance/**", "a/#b/**"]',
    }),
  );
  assert.deepEqual(found, []);
});

// --- check 2: the Node tree stays out of `bun test` ------------------------------------------------

test('the detector fails when a Node file escapes the ignore glob', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/node-conformance/*.test.mjs"]',
    }),
  );
  assert.match(messageFor(found, 2), /README\.md is not matched/);
});

test('the detector accepts a bare directory pattern, which is what Bun prunes on', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/node-conformance"]',
    }),
  );
  assert.deepEqual(found, []);
});

test('the detector fails when the Node tree holds no files', () => {
  const found = findPartitionViolations(sources({nodeTreeFiles: []}));
  assert.ok(checks(found).includes(2));
});

test('the detector treats ** as spanning whole segments, the way Bun does', () => {
  // `tests/**/s.test.mjs` must not cover `tests/node-conformance/wideSs.test.mjs`. Compiling `**`
  // to a bare `.*` matched it and Bun does not -- the direction that green-lights a config Bun
  // reads differently.
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/**/s.test.mjs"]',
      nodeTreeFiles: ['tests/node-conformance/wideSs.test.mjs'],
    }),
  );
  assert.ok(checks(found).includes(2));
});

// --- check 3: every case is reachable by the runner ------------------------------------------------

test('the detector fails when a Node case sits in a subdirectory the runner glob cannot reach', () => {
  const found = findPartitionViolations(
    sources({
      nodeTreeFiles: [
        ...NODE_CASES,
        'tests/node-conformance/io/byte-stream.test.mjs',
      ],
    }),
  );
  assert.match(
    messageFor(found, 3),
    /io\/byte-stream\.test\.mjs is not matched/,
  );
});

test('the detector fails when a case is misnamed so no runner glob reaches it', () => {
  // Ignored by Bun, unmatched by `test:node`, run by nothing — and `node --test` over a glob that
  // matches nothing exits 0, so without this the file is simply never mentioned again.
  for (const orphan of [
    'tests/node-conformance/retry.mjs',
    'tests/node-conformance/orphan.test.ts',
  ]) {
    const found = findPartitionViolations(
      sources({nodeTreeFiles: [...NODE_CASES, orphan]}),
    );
    assert.ok(checks(found).includes(3), `${orphan} slipped through`);
  }
});

test('the detector exempts the README from the runner glob', () => {
  assert.deepEqual(findPartitionViolations(sources()), []);
});

test('the detector fails when test:node points at the pre-Phase-10 tree', () => {
  const found = findPartitionViolations(
    sources({
      packageJson: JSON.stringify({
        scripts: {
          test: 'bun test ./packages ./tests',
          'test:node': 'node --test test/node-conformance/*.test.mjs',
        },
      }),
    }),
  );
  assert.ok(checks(found).includes(3));
});

test('the detector fails when package.json carries no test:node script at all', () => {
  const found = findPartitionViolations(
    sources({
      packageJson: JSON.stringify({
        scripts: {test: 'bun test ./packages ./tests'},
      }),
    }),
  );
  assert.match(messageFor(found, 3), /no `test:node` script/);
});

test('the detector fails when test:node names no .mjs path', () => {
  const found = findPartitionViolations(
    sources({
      packageJson: JSON.stringify({
        scripts: {
          test: 'bun test ./packages ./tests',
          'test:node': 'node --test',
        },
      }),
    }),
  );
  assert.match(messageFor(found, 3), /names no \.mjs path/);
});

// --- check 4: nothing else is caught by the ignore glob --------------------------------------------

test('the detector fails when the ignore glob widens over the Bun tree', () => {
  const found = findPartitionViolations(
    sources({
      bunfig: '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/**"]',
    }),
  );
  assert.ok(checks(found).includes(4));
});

test('the detector fails when a bare directory prunes part of the Bun tree', () => {
  // Bun applies these patterns while walking, so naming a directory drops everything beneath it
  // without matching any file path. Measured: adding `tests/conformance/fixtures` silently removed
  // `fixtures/settle.test.mjs` from the run while every file-path check stayed green.
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/node-conformance/**", "tests/conformance/xcut"]',
    }),
  );
  assert.match(messageFor(found, 4), /silently skips it/);
});

test('the detector fails when the ignore glob reaches the packages tree', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/node-conformance/**", "packages/**"]',
    }),
  );
  assert.ok(checks(found).includes(4));
});

test('the detector fails when the Bun tree has vanished, rather than passing vacuously', () => {
  const found = findPartitionViolations(
    sources({
      bunfig: '[test]\nroot = "packages"\npathIgnorePatterns = ["tests/**"]',
      bunTreeFiles: [],
    }),
  );
  assert.ok(checks(found).includes(4));
});

// --- check 5: the globs the other files carry ------------------------------------------------------

test('the detector fails when run-ci.mjs still names the pre-Phase-10 tree', () => {
  const found = findPartitionViolations(
    sources({runCi: '`node --test test/node-conformance/*.test.mjs`'}),
  );
  assert.ok(checks(found).includes(5));
});

test('the detector fails when run-ci.mjs loses one of its three globs', () => {
  const found = findPartitionViolations(
    sources({runCi: RUN_CI.split('\n').slice(0, 2).join('\n')}),
  );
  assert.match(messageFor(found, 5), /expected at least 3/);
});

test('the detector fails when a glob reaches only some of the cases', () => {
  const narrowed = RUN_CI.replaceAll(
    'tests/node-conformance/*.test.mjs',
    'tests/node-conformance/seams*.test.mjs',
  );
  const found = findPartitionViolations(sources({runCi: narrowed}));
  assert.match(messageFor(found, 5), /misses 1 of 2 cases/);
});

test('the detector fails when the eslint override glob goes stale', () => {
  const found = findPartitionViolations(
    sources({eslintConfig: "files: ['tests/node-conformance/*.cjs'],"}),
  );
  assert.ok(checks(found).includes(5));
});

test('the detector fails when the eslint override is deleted, leaving only prose about it', () => {
  // The comment above that entry quotes the glob. Scanning source and comments alike kept this
  // green after the real entry was gone: the sentence explaining the guarantee was what voided it.
  const found = findPartitionViolations(
    sources({
      eslintConfig: [
        '// The `tests/node-conformance/*.mjs` entry is one of the five strings.',
        "export default [{files: ['scripts/*.mjs']}];",
      ].join('\n'),
    }),
  );
  assert.match(
    messageFor(found, 5),
    /carries 0 tests\/node-conformance\/ glob/,
  );
});

test('the detector fails when the README stops naming the tree it documents', () => {
  const found = findPartitionViolations(
    sources({readme: 'This suite runs on Node. Nothing here names a path.'}),
  );
  assert.ok(checks(found).includes(5));
});

test('the detector does not mistake a run-ci step label for a glob', () => {
  // `node-conformance (matrix)` carries no slashes, so it never reaches the star filter.
  const found = findPartitionViolations(
    sources({
      runCi: [
        "  {ci: 'node-conformance (matrix)', cmd: 'bun run test:node'},",
        RUN_CI,
      ].join('\n'),
    }),
  );
  assert.deepEqual(found, []);
});

// --- checks 6 and 7: the two further rules the hard rule states ------------------------------------

test('the detector fails when the root test script stops naming both trees', () => {
  const found = findPartitionViolations(
    sources({
      packageJson: JSON.stringify({
        scripts: {
          test: 'bun test',
          'test:node': 'node --test tests/node-conformance/*.test.mjs',
        },
      }),
    }),
  );
  assert.match(messageFor(found, 6), /must pass both trees whole/);
});

test('the detector fails when the root test script is narrowed to one subtree', () => {
  const found = findPartitionViolations(
    sources({
      packageJson: JSON.stringify({
        scripts: {
          test: 'bun test ./packages ./tests/conformance',
          'test:node': 'node --test tests/node-conformance/*.test.mjs',
        },
      }),
    }),
  );
  assert.ok(checks(found).includes(6));
});

test('the detector fails when bunfig loses its [test] root key', () => {
  const found = findPartitionViolations(
    sources({
      bunfig: '[test]\npathIgnorePatterns = ["tests/node-conformance/**"]',
    }),
  );
  assert.match(messageFor(found, 7), /`\[test\] root` is absent/);
});

test('the detector fails when [test] root is repointed away from packages', () => {
  const found = findPartitionViolations(
    sources({
      bunfig:
        '[test]\nroot = "."\npathIgnorePatterns = ["tests/node-conformance/**"]',
    }),
  );
  assert.match(messageFor(found, 7), /expected "packages"/);
});

// --- several at once -------------------------------------------------------------------------------

test('the detector reports every drifted string, not only the first', () => {
  const found = findPartitionViolations(
    sources({
      bunfig: '[test]\npathIgnorePatterns = ["tests/node-conformance/**"]',
      packageJson: JSON.stringify({
        scripts: {
          test: 'bun test',
          'test:node': 'node --test test/node-conformance/*.test.mjs',
        },
      }),
      eslintConfig: "files: ['test/node-conformance/*.mjs'],",
    }),
  );
  assert.deepEqual(checks(found), [3, 5, 6, 7]);
});
