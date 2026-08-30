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
// Both builds sweep `dist/` and every `*.tsbuildinfo` first. Without the sweep the second `tsc` is
// incremental and rewrites nothing, so the comparison passes by not having run — the failure mode
// that makes a naive version of this gate worthless.
//
// Non-determinism this would catch: a timestamp or absolute path baked into emitted output, a
// `Math.random()`/`Date.now()` reaching a build-time codegen step
// (`packages/core/scripts/gen-version.mjs` is the one such step today, and injecting a `Date.now()`
// there is this gate's negative test), or a `tsc` upgrade that starts emitting map keys in hash
// order.
//
// TWO LEGS, because "the artifact" means two different things. The emit leg compares every file under
// each package's `dist/`. The pack leg then runs `npm pack` on every publishable package and compares
// the tarball digests — that is the byte sequence a consumer actually installs, and it is what the
// Phase 10 commit message asserted was reproducible on the strength of a by-hand check. Gating it is
// the difference between an asserted property and a verified one.
//
// The pack leg is deliberately kept: it is deterministic here because `npm pack` normalizes tar
// entries (fixed mtime, sorted order, portable mode bits) rather than stamping wall-clock time into
// the header — verified by packing `@dexpace/core` twice, seconds apart, on npm 12.0.1 and getting one
// digest. Both packs also happen inside a single run on a single npm, so an npm upgrade cannot make
// this flap. It adds ~7s and a dependency on `npm` being on PATH, which the Node toolchain CI already
// installs; a missing `npm` fails the gate loudly rather than skipping the leg.
//
// What the pack leg does NOT add much of, stated so nobody over-reads it: with `files: ["dist"]` on
// every publishable package, the tarball is a pure function of the `dist/` bytes the first leg already
// compared plus static manifest files. Its real job is to pin `npm pack`'s own normalization, and to
// catch a future `files`/`.npmignore` change that starts shipping something time-varying from outside
// `dist/`.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
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

/**
 * Every package `npm pack` produces a publishable tarball for. `private: true` packages
 * (`shrink-test`, `transport-conformance`) never ship, so their bytes are not an artifact.
 */
function publishablePackages() {
  const names = [];
  for (const pkg of readdirSync(packagesDir, {withFileTypes: true})) {
    if (!pkg.isDirectory()) continue;
    const manifest = join(packagesDir, pkg.name, 'package.json');
    try {
      if (JSON.parse(readFileSync(manifest, 'utf8')).private !== true) {
        names.push(pkg.name);
      }
    } catch {
      // No manifest — not a package, so nothing to pack.
    }
  }
  return names.sort();
}

/**
 * Map of `npm-pack:<tarball>` → SHA-256 of the tarball, packed into a temp dir this owns.
 *
 * Packing outside the repo keeps the tarballs out of `collectArtifacts()`'s walk and out of
 * `git status`; the dir is removed even when a pack throws.
 */
function digestTarballs(label) {
  process.stdout.write(`verify-reproducible-build: ${label} pack…\n`);
  const dest = mkdtempSync(join(tmpdir(), `dexpace-repro-${label}-`));
  try {
    for (const name of publishablePackages()) {
      execFileSync('npm', ['pack', '--pack-destination', dest], {
        cwd: join(packagesDir, name),
        // `npm pack` narrates the whole tarball manifest on stderr; the digests are the signal.
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    }
    const digests = new Map();
    for (const file of readdirSync(dest).sort()) {
      digests.set(
        `npm-pack:${file}`,
        createHash('sha256')
          .update(readFileSync(join(dest, file)))
          .digest('hex'),
      );
    }
    return digests;
  } finally {
    rmSync(dest, {recursive: true, force: true});
  }
}

/** The three ways two digest maps can disagree, rendered for the assertion message. */
function diffDigests(a, b) {
  return [
    ...[...a.keys()]
      .filter(path => !b.has(path))
      .map(path => `  only in build 1: ${path}`),
    ...[...b.keys()]
      .filter(path => !a.has(path))
      .map(path => `  only in build 2: ${path}`),
    ...[...a.entries()]
      .filter(([path, hash]) => b.has(path) && b.get(path) !== hash)
      .map(([path]) => `  differing bytes:  ${path}`),
  ];
}

// Fail here rather than inside the first `npm pack`, where an ENOENT from execFileSync reads as a
// packaging defect instead of a missing tool.
assert.equal(
  spawnSync('npm', ['--version'], {stdio: 'ignore'}).status,
  0,
  'NFR-12: `npm` is not on PATH, so the pack leg cannot run. Install Node’s npm, or run the' +
    ' emit leg alone by hand.',
);

sweep();
build('first');
const first = digestArtifacts();
const firstTarballs = digestTarballs('first');

assert.ok(
  first.size > 0,
  'NFR-12: the build emitted no artifacts at all — nothing to compare',
);
assert.ok(
  firstTarballs.size > 0,
  'NFR-12: no publishable package produced a tarball — nothing to compare',
);

sweep();
build('second');
const second = digestArtifacts();
const secondTarballs = digestTarballs('second');

const problems = [
  ...diffDigests(first, second),
  ...diffDigests(firstTarballs, secondTarballs),
];

assert.equal(
  problems.length,
  0,
  `NFR-12 violation: two clean builds of an identical source tree differed.\n${problems.join('\n')}`,
);

process.stdout.write(
  `verify-reproducible-build: OK — ${String(first.size)} emitted files and ` +
    `${String(firstTarballs.size)} npm-pack tarballs byte-identical across two clean builds (NFR-12)\n`,
);
