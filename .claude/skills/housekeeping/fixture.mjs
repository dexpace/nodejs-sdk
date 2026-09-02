// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/fixture.mjs
//
// Builds a throwaway repository the probe and the apply stage can be pointed at, so a test
// can assert a check FIRES rather than asserting the live tree happens to be clean.
//
// The distinction is not academic. Before these fixtures existed, replacing the bodies of
// seven of the eight checks with `return;` left the whole suite green, and so did deleting
// `apply.mjs`'s only `assertAllWritable` call. `scripts/verify-seam-1.test.mjs:6`,
// `verify-knowledge-structure.test.mjs:4` and `verify-test-partition.test.mjs:4` had each
// already reached that conclusion in this repository and say so in their own headers.
//
// Only used by tests, so `node:fs` and `node:child_process` are fine here — the
// zero-`node:` invariant governs `packages/*/src`, not tooling.

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

/** A CI workflow with a known shape: two jobs, three named steps. */
const WORKFLOW = `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install
        run: bun install

      - name: Verify seam
        run: bun run verify:seam-1

  node-conformance:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - name: Node conformance
        run: bun run test:node
`;

/**
 * The counts a fixture's own documents must state to be clean:
 * 2 packages (1 publishable, 1 private), 1 API report, 3 named CI steps, 2 jobs.
 */
export const CLEAN_CLAIMS = [
  'Two packages, one is published and one is `private`.',
  'One committed report.',
  'Three named steps across two jobs.',
  'Gates: `verify:seam-1`.',
  '`@dexpace/thing` and `@dexpace/secret` are the packages.',
].join('\n\n');

function write(root, path, text) {
  mkdirSync(join(root, dirname(path)), {recursive: true});
  writeFileSync(join(root, path), text);
}

/**
 * A minimal repository the probe reports clean over.
 *
 * `overrides` replaces or adds files after the clean tree is written; a value of `null`
 * deletes. `untracked` is written after `git add`, so it stays untracked.
 */
export function makeFixture({overrides = {}, untracked = {}} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'housekeeping-fixture-'));

  write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: 'fixture',
        private: true,
        scripts: {'verify:seam-1': 'true', test: 'true'},
      },
      null,
      2,
    )}\n`,
  );
  write(root, '.github/workflows/ci.yml', WORKFLOW);

  write(
    root,
    'packages/thing/package.json',
    `${JSON.stringify(
      {name: '@dexpace/thing', peerDependencies: {'@dexpace/core': '*'}},
      null,
      2,
    )}\n`,
  );
  write(root, 'packages/thing/etc/thing.api.md', '# API\n');
  write(
    root,
    'packages/thing/README.md',
    `# @dexpace/thing\n\n${'Long enough to clear the thin-README floor. '.repeat(25)}\n`,
  );
  write(
    root,
    'packages/secret/package.json',
    `${JSON.stringify({name: '@dexpace/secret', private: true}, null, 2)}\n`,
  );

  write(
    root,
    'CLAUDE.md',
    `# CLAUDE.md\n\n${CLEAN_CLAIMS}\n\ndocs/README.md, docs/open-items.md, docs/work, docs/sdk-documentation, docs/superpowers.\n`,
  );
  write(root, 'README.md', `# fixture\n\n${CLEAN_CLAIMS}\n`);
  write(
    root,
    'docs/README.md',
    '# docs\n\nEntries: README.md, open-items.md, work, sdk-documentation, superpowers.\n',
  );
  write(
    root,
    'docs/open-items.md',
    '# Open Items\n\n### A1 — a real item — **WATCH**\n\nBody.\n',
  );
  write(root, 'docs/superpowers/README.md', '# inbox\n');
  write(root, 'docs/work/mvp/phase1/2026-01-01-phase1-thing.md', '# phase 1\n');
  write(root, 'docs/sdk-documentation/architecture.md', '# architecture\n');

  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) {
      rmSync(join(root, path), {force: true, recursive: true});
      continue;
    }
    write(root, path, text);
  }

  execFileSync('git', ['init', '-q'], {cwd: root});
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'fixture'], {cwd: root});
  execFileSync('git', ['add', '-A'], {cwd: root});
  execFileSync('git', ['commit', '-qm', 'fixture'], {cwd: root});

  for (const [path, text] of Object.entries(untracked)) write(root, path, text);

  return root;
}

export function removeFixture(root) {
  rmSync(root, {recursive: true, force: true});
}
