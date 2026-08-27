// SPDX-License-Identifier: MIT
// scripts/verify-seam-1.test.mjs
// Exercises: SEAM-1 / NFR-1 (no runtime dependencies in any shipped package), and the
// peer-dependency rule from sdk-design-nodejs/02 §2 that guards the dual-package hazard.
//
// Tests the GATE, not a copy of its logic. An earlier draft re-read the same manifests and asserted
// the same invariants, which passes just as happily when `verify-seam-1.mjs` has stopped checking
// anything -- a bad glob, a swallowed assertion, an early `continue`. So this spawns the script and
// reads its exit code and output instead.
//
// Lives in `scripts/` and runs under `node --test` via `bun run test:scripts`, so `node:fs` and
// `node:child_process` are permitted here -- the zero-`node:` invariant governs `packages/*/src`,
// not build tooling.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

// Absolute, never cwd-relative: `node --test` is run from the repo root today, and a relative
// `readdirSync('packages')` silently starts checking the wrong tree the day it is not.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = join(repoRoot, 'scripts', 'verify-seam-1.mjs');
const packagesDir = join(repoRoot, 'packages');

const PACKAGES = readdirSync(packagesDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

test('the workspace has more than one package, so these checks are not vacuous', () => {
  assert.ok(
    PACKAGES.includes('core'),
    `expected packages/core, found ${PACKAGES.join(', ')}`,
  );
  assert.ok(
    PACKAGES.includes('codec-json'),
    `expected packages/codec-json, found ${PACKAGES.join(', ')}`,
  );
});

test('verify-seam-1.mjs exits 0 and reports covering every package', () => {
  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  // The count is the part worth asserting: it is what proves the gate widened with the workspace
  // rather than staying pinned to core. A hard-coded `1` here would defeat the point.
  assert.match(
    output,
    new RegExp(
      `SEAM-1 check passed: ${String(PACKAGES.length)} package\\(s\\) have zero runtime dependencies`,
    ),
    `unexpected output from verify-seam-1.mjs:\n${output}`,
  );
});

// Copies the real script into a throwaway tree with fixture manifests beside it, so the failure
// paths are driven through the ACTUAL script rather than through a restatement of its assertions.
// The script resolves `packages/` relative to its own location, which is what makes this possible.
function runAgainstFixture(manifests) {
  const dir = mkdtempSync(join(tmpdir(), 'dexpace-seam-1-'));
  mkdirSync(join(dir, 'scripts'), {recursive: true});
  copyFileSync(script, join(dir, 'scripts', 'verify-seam-1.mjs'));
  for (const [name, manifest] of Object.entries(manifests)) {
    mkdirSync(join(dir, 'packages', name), {recursive: true});
    writeFileSync(
      join(dir, 'packages', name, 'package.json'),
      JSON.stringify(manifest),
    );
  }
  try {
    return execFileSync(
      process.execPath,
      [join(dir, 'scripts', 'verify-seam-1.mjs')],
      {encoding: 'utf8', stdio: 'pipe'},
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const CLEAN_CORE = {name: '@dexpace/core', dependencies: {}};
const CLEAN_ADAPTER = {
  name: '@dexpace/codec-fake',
  dependencies: {},
  peerDependencies: {'@dexpace/core': 'workspace:*'},
  peerDependenciesMeta: {'@dexpace/core': {optional: false}},
};

test('the fixture harness itself passes on a well-formed tree', () => {
  assert.match(
    runAgainstFixture({core: CLEAN_CORE, 'codec-fake': CLEAN_ADAPTER}),
    /SEAM-1 check passed: 2 package\(s\)/,
  );
});

test('verify-seam-1.mjs fails when any package declares a runtime dependency', () => {
  assert.throws(
    () =>
      runAgainstFixture({
        core: CLEAN_CORE,
        'codec-fake': {...CLEAN_ADAPTER, dependencies: {lodash: '^4'}},
      }),
    /SEAM-1 violation: @dexpace\/codec-fake/,
    'a non-empty dependencies map on a non-core package did not fail the gate',
  );
});

test('verify-seam-1.mjs fails when core itself grows a runtime dependency', () => {
  assert.throws(
    () =>
      runAgainstFixture({
        core: {...CLEAN_CORE, dependencies: {undici: '^6'}},
        'codec-fake': CLEAN_ADAPTER,
      }),
    /SEAM-1 violation: @dexpace\/core/,
  );
});

test('verify-seam-1.mjs fails when an adapter declares no @dexpace/core peerDependency', () => {
  const noPeer = {...CLEAN_ADAPTER};
  delete noPeer.peerDependencies;
  assert.throws(
    () => runAgainstFixture({core: CLEAN_CORE, 'codec-fake': noPeer}),
    /dual-package hazard: @dexpace\/codec-fake must declare @dexpace\/core as a peerDependency/,
  );
});

test('verify-seam-1.mjs fails when the peerDependenciesMeta entry is missing', () => {
  const noMeta = {...CLEAN_ADAPTER};
  delete noMeta.peerDependenciesMeta;
  assert.throws(
    () => runAgainstFixture({core: CLEAN_CORE, 'codec-fake': noMeta}),
    /must carry a peerDependenciesMeta entry/,
  );
});
