// SPDX-License-Identifier: MIT
// scripts/verify-seam-1.mjs
//
// SEAM-1 / NFR-1: no shipped package carries a runtime dependency it was not explicitly granted.
// Generalized from a core-only check in Phase 6a, when `@dexpace/codec-json` became the workspace's
// second package — a check hard-coded to one package silently stops covering the workspace the moment
// it grows. Phase 8a turned the blanket ban into an allow-list, because NFR-2 grants each optional
// capability core plus at most one external library: `ALLOWED_RUNTIME_DEPENDENCIES` below is that
// grant, written out per package. Every package absent from it is still held to a hard-committed
// empty `dependencies` object — an omitted field is a violation too, so the manifest states the
// invariant rather than merely failing to contradict it.
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

const ALLOWED_RUNTIME_DEPENDENCIES = {
  '@dexpace/transport-fetch': ['@dexpace/transport-shared'],
  '@dexpace/transport-undici': ['@dexpace/transport-shared', 'undici'],
};

let checkedCount = 0;

for (const dir of packageDirs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

  // A private package is never published, so neither the dependency budget nor the dual-package
  // hazard below can reach a consumer through it.
  if (manifest.private === true) continue;
  checkedCount++;

  const allowedDeps = ALLOWED_RUNTIME_DEPENDENCIES[manifest.name];

  if (allowedDeps === undefined) {
    assert.deepEqual(
      manifest.dependencies,
      {},
      `SEAM-1 violation: ${manifest.name} must declare zero runtime dependencies (a hard-committed empty object)`,
    );
  } else {
    const unexpected = Object.keys(manifest.dependencies ?? {}).filter(
      dep => !allowedDeps.includes(dep),
    );
    assert.equal(
      unexpected.length,
      0,
      `SEAM-1 / NFR-2 violation: ${manifest.name} declared unexpected runtime dependencies: ${unexpected.join(', ')}`,
    );
  }

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
  `SEAM-1 check passed: ${String(checkedCount)} package(s) verified against dependency boundaries`,
);
