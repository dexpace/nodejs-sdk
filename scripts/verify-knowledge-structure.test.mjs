// SPDX-License-Identifier: MIT
// scripts/verify-knowledge-structure.test.mjs
//
// Run with `bun run test:scripts`. Tests the detector, not the corpus: the
// corpus being clean today is what `bun run verify:knowledge-structure` says in
// CI, and a gate nobody has seen fail is a gate nobody trusts.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {
  noteViolations,
  sourceRoots,
  strayTopicFiles,
  structuralViolations,
} from './verify-knowledge-structure.mjs';

const ROOTS = [
  '/home/u/styleguide/typescript',
  'docs/product-spec',
  'docs/sdk-design-nodejs',
];

function entry(overrides) {
  return {
    file: 'topic.md',
    topic: 'topic',
    origin: 'harvested',
    line: 4,
    section: 'Rules',
    roles: ['spec'],
    role: 'spec',
    sources: ['docs/product-spec/04-core-http-domain-model.md:9'],
    ...overrides,
  };
}

test('the source roots are derived from the manifest, not hardcoded', () => {
  const roots = sourceRoots(
    [
      '# Harvested Sources',
      '',
      '| source | role | sha256 | last harvest |',
      '| --- | --- | --- | --- |',
      '| `/home/u/styleguide/typescript/01-formatting.md` | styleguide | `aaa` | 2026-07-25 |',
      '| `docs/product-spec/04-core-http-domain-model.md` | spec | `bbb` | 2026-07-25 |',
      '| `docs/product-spec/12-pagination.md` | spec | `ccc` | 2026-07-25 |',
    ].join('\n'),
  );
  assert.deepEqual(roots, [
    '/home/u/styleguide/typescript',
    'docs/product-spec',
  ]);
});

test('a manifest that parses to nothing fails loudly', () => {
  assert.throws(() => sourceRoots('# Harvested Sources\n'), /zero source rows/);
});

test('a clean pair of trees reports no violation', () => {
  const entries = [
    entry({}),
    entry({
      origin: 'note',
      section: 'Superseded',
      roles: ['review'],
      role: 'review',
      sources: [
        'docs/superpowers/specs/2026-07-28-phase6c-pagination-design.md',
      ],
    }),
  ];
  assert.deepEqual(structuralViolations(entries, ROOTS), []);
  assert.deepEqual(noteViolations(entries), []);
});

test('a review-role entry under harvested/ is a violation', () => {
  const [violation, ...rest] = structuralViolations(
    [entry({roles: ['review'], role: 'review'})],
    ROOTS,
  );
  assert.equal(rest.length, 0);
  assert.match(violation, /role `review` under harvested\//);
  assert.match(violation, /topic\.md:4/);
});

test('a Superseded entry under harvested/ is a violation', () => {
  const [violation] = structuralViolations(
    [entry({section: 'Superseded'})],
    ROOTS,
  );
  assert.match(violation, /Superseded entry under harvested\//);
});

test('a harvested <sub> citing outside the three roots is a violation', () => {
  const [violation] = structuralViolations(
    [entry({sources: ['docs/superpowers/plans/2026-07-28-phase9.md:1097']})],
    ROOTS,
  );
  assert.match(violation, /cites `docs\/superpowers\/plans/);
  assert.match(violation, /under none of the harvested source roots/);
});

test('a line range or a bare path both resolve to their root', () => {
  const ranged = entry({
    sources: ['/home/u/styleguide/typescript/06-classes.md:168-183'],
  });
  const bare = entry({sources: ['docs/sdk-design-nodejs/04-domain.md']});
  assert.deepEqual(structuralViolations([ranged, bare], ROOTS), []);
});

test('a prefix match is on a path segment, not on characters', () => {
  const sibling = entry({sources: ['docs/product-spec-draft/04-core.md:9']});
  const [violation] = structuralViolations([sibling], ROOTS);
  assert.match(violation, /docs\/product-spec-draft/);
});

test('the same shapes are allowed under notes/, which is hand-written', () => {
  const note = entry({
    origin: 'note',
    section: 'Superseded',
    roles: ['review'],
    role: 'review',
    sources: ['docs/superpowers/plans/2026-07-28-phase9.md:1097'],
  });
  assert.deepEqual(structuralViolations([note], ROOTS), []);
});

test('a topic file stranded at the root is caught', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-stray-'));
  mkdirSync(join(dir, 'harvested'));
  writeFileSync(join(dir, 'harvested', 'api-design.md'), '## Rules\n');
  assert.deepEqual(strayTopicFiles(dir), [], 'a tree is not a stray file');

  writeFileSync(join(dir, 'README.md'), '# the two trees\n');
  assert.deepEqual(
    strayTopicFiles(dir),
    [],
    'README.md is the contract, not a topic',
  );

  writeFileSync(join(dir, 'pagination.md'), '## Rules\n');
  const [violation, ...rest] = strayTopicFiles(dir);
  assert.equal(rest.length, 0);
  assert.match(violation, /pagination\.md: a topic file at the root/);
  assert.match(violation, /--corpus docs\/knowledge\/harvested/);
});

test('the live corpus has nothing stranded at its root', () => {
  assert.deepEqual(strayTopicFiles(), []);
});

test('a harvested entry with no provenance line at all is caught', () => {
  const [violation, ...rest] = structuralViolations(
    [entry({sources: [], roles: [], role: null, subLine: null})],
    ROOTS,
  );
  assert.equal(rest.length, 0);
  assert.match(violation, /no source/);
  assert.match(violation, /written by hand/);
});

test('an invented role under harvested/ is caught, not just `review`', () => {
  const [violation, ...rest] = structuralViolations(
    [entry({roles: ['impl'], role: 'impl'})],
    ROOTS,
  );
  assert.equal(rest.length, 0);
  assert.match(violation, /role `impl` under harvested\//);
  assert.match(violation, /spec, design, styleguide/);
});

test('a source root that contains another root is refused, not widened', () => {
  assert.throws(
    () =>
      sourceRoots(
        [
          '| `docs/product-spec/04-core.md` | spec | `aaa` | 2026-07-25 |',
          '| `docs/open-items.md` | design | `bbb` | 2026-07-25 |',
        ].join('\n'),
      ),
    /which contains/,
  );
});

test('a `..` segment cannot walk out of a source root', () => {
  const escaping = entry({
    sources: ['docs/product-spec/../../etc/passwd'],
  });
  const [violation] = structuralViolations([escaping], ROOTS);
  assert.match(violation, /under none of the harvested source roots/);
});

test('a note that is not review-role is a violation, not a warning', () => {
  const note = entry({origin: 'note', roles: ['design'], role: 'design'});
  assert.deepEqual(
    structuralViolations([note], ROOTS),
    [],
    'the harvested rules do not apply to a note',
  );
  const [violation, ...rest] = noteViolations([note]);
  assert.equal(rest.length, 0);
  assert.match(violation, /notes\/topic\.md:4/);
  assert.match(violation, /`design`, not `review`/);
});
