// SPDX-License-Identifier: MIT
// scripts/verify-seam-1.mjs
//
// SEAM-1 / NFR-1: no shipped package carries a runtime dependency. Generalized from a core-only
// check in Phase 6a, when `@dexpace/codec-json` became the workspace's second package — a check
// hard-coded to one package silently stops covering the workspace the moment it grows.
//
// It also asserts the peer-dependency pairing `sdk-design-nodejs/02` §2 prescribes for every adapter
// package. That is not a style rule: without it npm's nested resolution can install two
// non-identical copies of @dexpace/core, and the branded-identity checks that distinguish core types
// — `Tristate`'s discriminant among them — break exactly the way two JVM classloaders break
// `instanceof`.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packagesDir = fileURLToPath(new URL('../packages', import.meta.url));

const packageDirs = readdirSync(packagesDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => join(packagesDir, entry.name))
  .filter(dir => existsSync(join(dir, 'package.json')));

assert.ok(packageDirs.length > 0, 'no packages found under packages/');

for (const dir of packageDirs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

  assert.deepEqual(
    manifest.dependencies,
    {},
    `SEAM-1 violation: ${manifest.name} must declare zero runtime dependencies (a hard-committed empty object)`,
  );

  if (manifest.name === '@dexpace/core') continue;

  assert.ok(
    manifest.peerDependencies?.['@dexpace/core'],
    `dual-package hazard: ${manifest.name} must declare @dexpace/core as a peerDependency, not a regular dependency`,
  );
  assert.ok(
    manifest.peerDependenciesMeta?.['@dexpace/core'],
    `dual-package hazard: ${manifest.name} must carry a peerDependenciesMeta entry for @dexpace/core`,
  );
}

console.log(
  `SEAM-1 check passed: ${String(packageDirs.length)} package(s) have zero runtime dependencies`,
);
