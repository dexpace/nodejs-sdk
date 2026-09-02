// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/guard.test.mjs
//
// The guard is the one part of this skill that must not be wrong, because everything it
// protects is a document no other copy of exists. These cases are the three ways a naive
// `startsWith` implementation fails, plus proof that the mutable half stays mutable.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {
  FROZEN,
  FrozenPathError,
  assertAllWritable,
  assertWritable,
  frozenEntryFor,
  isFrozen,
} from './guard.mjs';

const ROOT = '/repo';

test('every frozen entry is itself refused', () => {
  for (const entry of FROZEN) {
    assert.equal(frozenEntryFor(entry, ROOT), entry, entry);
  }
});

test('a file under a frozen tree is refused, at any depth', () => {
  assert.equal(
    frozenEntryFor('docs/product-spec/04-core.md', ROOT),
    'docs/product-spec',
  );
  assert.equal(
    frozenEntryFor('docs/knowledge/harvested/documentation.md', ROOT),
    'docs/knowledge',
  );
  assert.equal(
    frozenEntryFor('docs/knowledge/notes/pagination.md', ROOT),
    'docs/knowledge',
  );
  assert.equal(
    frozenEntryFor('docs/sdk-design-nodejs/10-deliberate-deviations.md', ROOT),
    'docs/sdk-design-nodejs',
  );
});

test('a SIBLING whose name merely starts with a frozen one is writable', () => {
  // The failure a raw string prefix test would produce, and the reason the comparison is
  // segment-wise. `verify-knowledge-structure.mjs` guards the same shape for source roots.
  assert.equal(isFrozen('docs/product-spec-draft/04-core.md', ROOT), false);
  assert.equal(isFrozen('docs/knowledge-notes.md', ROOT), false);
  assert.equal(isFrozen('docs/sdk-design-nodejs-old/01.md', ROOT), false);
  assert.equal(isFrozen('docs/product-spec.md.bak', ROOT), false);
});

test('a `..` segment that lands inside is refused', () => {
  assert.equal(
    frozenEntryFor('docs/work/../product-spec/04-core.md', ROOT),
    'docs/product-spec',
  );
  assert.equal(
    frozenEntryFor('docs/sdk-documentation/../knowledge/x.md', ROOT),
    'docs/knowledge',
  );
});

test('a `..` segment that escapes upward is not mistaken for containment', () => {
  assert.equal(
    isFrozen('docs/product-spec/../work/mvp/phase1/x.md', ROOT),
    false,
  );
  assert.equal(isFrozen('docs/knowledge/../README.md', ROOT), false);
});

test('an absolute path is resolved, not treated as relative', () => {
  assert.equal(
    frozenEntryFor(resolve(ROOT, 'docs/product-spec/04.md'), ROOT),
    'docs/product-spec',
  );
  // An absolute path outside the repository is nobody's business but is certainly not frozen.
  assert.equal(isFrozen('/elsewhere/docs/product-spec/04.md', ROOT), false);
});

test('everything the skill is allowed to write stays writable', () => {
  for (const path of [
    'docs/README.md',
    'docs/open-items.md',
    'docs/deferred-items.md',
    'docs/deviations.md',
    'docs/sdk-documentation/architecture.md',
    'docs/work/mvp/phase1/2026-07-23-phase1-core-http-domain-model.md',
    'docs/superpowers/specs/2026-09-01-x-design.md',
    'docs/assets/dexpace-wordmark-dark.svg',
    'CLAUDE.md',
    'README.md',
    'packages/core/README.md',
  ]) {
    assert.equal(isFrozen(path, ROOT), false, path);
    assert.equal(assertWritable(path, ROOT), path);
  }
});

test('assertWritable throws a FrozenPathError naming both paths', () => {
  assert.throws(
    () => assertWritable('docs/product-spec/04-core.md', ROOT),
    error => {
      assert.ok(error instanceof FrozenPathError);
      assert.equal(error.name, 'FrozenPathError');
      assert.equal(error.frozen, 'docs/product-spec');
      assert.match(error.message, /refusing to write/);
      return true;
    },
  );
});

test('assertAllWritable refuses the whole batch before performing any of it', () => {
  const batch = ['docs/README.md', 'docs/product-spec/04-core.md', 'CLAUDE.md'];
  assert.throws(() => assertAllWritable(batch, ROOT), FrozenPathError);
  assert.deepEqual(assertAllWritable(['docs/README.md', 'CLAUDE.md'], ROOT), [
    'docs/README.md',
    'CLAUDE.md',
  ]);
});

test('the frozen list is exactly the five docs/README.md names', () => {
  // Pinned deliberately: widening this list is a decision about what a maintenance tool
  // may edit, and it must be a reviewed diff here rather than a silent constant change.
  assert.deepEqual(
    [...FROZEN],
    [
      'docs/knowledge',
      'docs/product-spec',
      'docs/sdk-design-nodejs',
      'docs/product-spec.md',
      'docs/sdk-design-nodejs.md',
    ],
  );
});

test('a SYMLINK into a frozen tree is refused', () => {
  // Lexically `docs/work/...` escapes every frozen entry; physically it lands inside
  // `docs/product-spec`. `apply.mjs`'s `mkdirSync(…, {recursive: true})` follows the link,
  // so a purely lexical guard says yes and `git mv` writes into the normative tree.
  const root = mkdtempSync(join(tmpdir(), 'guard-symlink-'));
  try {
    mkdirSync(join(root, 'docs/product-spec'), {recursive: true});
    symlinkSync(
      join(root, 'docs/product-spec'),
      join(root, 'docs/work'),
      'dir',
    );

    assert.equal(
      frozenEntryFor('docs/work/mvp/phase9/x.md', root),
      'docs/product-spec',
      'a symlinked path into a frozen tree must be refused',
    );
    assert.throws(
      () => assertWritable('docs/work/mvp/phase9/x.md', root),
      FrozenPathError,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a real docs/work directory stays writable', () => {
  // The other half: resolving symlinks must not make the ordinary tree frozen.
  const root = mkdtempSync(join(tmpdir(), 'guard-real-'));
  try {
    mkdirSync(join(root, 'docs/product-spec'), {recursive: true});
    mkdirSync(join(root, 'docs/work/mvp/phase9'), {recursive: true});
    assert.equal(isFrozen('docs/work/mvp/phase9/x.md', root), false);
    assert.equal(isFrozen('docs/product-spec/04.md', root), true);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a target whose ancestors do not exist yet is still judged', () => {
  // The normal case for a move: nothing at the destination.
  const root = mkdtempSync(join(tmpdir(), 'guard-absent-'));
  try {
    assert.equal(
      frozenEntryFor('docs/product-spec/new/deep/x.md', root),
      'docs/product-spec',
    );
    assert.equal(isFrozen('docs/work/mvp/phase1/x.md', root), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
