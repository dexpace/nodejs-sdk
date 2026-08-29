// SPDX-License-Identifier: MIT
// scripts/verify-reproducible-build.mjs
//
// NFR-12: an identical source tree MUST produce a byte-identical build.
//
// This row sat open through Phase 10 on the stated grounds that it "cannot execute without a real
// build artifact" — true while the repository was docs-only, and false from Phase 1 on. The check is
// mechanical: build the workspace twice from a swept tree and compare a SHA-256 of every emitted
// file. Asserting reproducibility without running it is exactly the kind of claimed-but-unverified
// conformance `docs/open-items.md` exists to catch.
//
// Both legs sweep `dist/` and every `*.tsbuildinfo` first. Without the sweep the second `tsc` is
// incremental and rewrites nothing, so the comparison passes by not having run — the failure mode
// that makes a naive version of this gate worthless.
//
// Non-determinism this would catch: a timestamp or absolute path baked into emitted output, a
// `Math.random()`/`Date.now()` reaching a build-time codegen step (`scripts/gen-version.mjs` is the
// one such step today), or a `tsc` upgrade that starts emitting map keys in hash order.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(repoRoot, 'packages');

/** Every file under a package's `dist/`, repo-relative, sorted for a stable comparison order. */
function collectArtifacts() {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  for (const pkg of readdirSync(packagesDir, {withFileTypes: true})) {
    if (!pkg.isDirectory()) continue;
    const dist = join(packagesDir, pkg.name, 'dist');
    try {
      if (statSync(dist).isDirectory()) walk(dist);
    } catch {
      // No dist/ for this package (private, or source-resolved) — nothing to compare.
    }
  }
  return files.sort();
}

/** Sweep every build output so the next build starts from the tree CI checks out, not a warm one. */
function sweep() {
  const walkAndDelete = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist') rmSync(full, {recursive: true, force: true});
        else walkAndDelete(full);
      } else if (entry.name.endsWith('.tsbuildinfo')) {
        rmSync(full, {force: true});
      }
    }
  };
  walkAndDelete(packagesDir);
}

function build(label) {
  process.stdout.write(`verify-reproducible-build: ${label} build…\n`);
  execFileSync('bun', ['run', 'build'], {cwd: repoRoot, stdio: 'inherit'});
}

/** Map of repo-relative path → SHA-256 of the file's bytes. */
function digestArtifacts() {
  const digests = new Map();
  for (const file of collectArtifacts()) {
    digests.set(
      relative(repoRoot, file),
      createHash('sha256').update(readFileSync(file)).digest('hex'),
    );
  }
  return digests;
}

sweep();
build('first');
const first = digestArtifacts();

assert.ok(
  first.size > 0,
  'NFR-12: the build emitted no artifacts at all — nothing to compare',
);

sweep();
build('second');
const second = digestArtifacts();

const onlyInFirst = [...first.keys()].filter(path => !second.has(path));
const onlyInSecond = [...second.keys()].filter(path => !first.has(path));
const differing = [...first.entries()]
  .filter(([path, hash]) => second.has(path) && second.get(path) !== hash)
  .map(([path]) => path);

const problems = [
  ...onlyInFirst.map(p => `  only in build 1: ${p}`),
  ...onlyInSecond.map(p => `  only in build 2: ${p}`),
  ...differing.map(p => `  differing bytes:  ${p}`),
];

assert.equal(
  problems.length,
  0,
  `NFR-12 violation: two clean builds of an identical source tree differed.\n${problems.join('\n')}`,
);

process.stdout.write(
  `verify-reproducible-build: OK — ${String(first.size)} emitted files byte-identical across two clean builds (NFR-12)\n`,
);
