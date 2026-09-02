// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/apply.test.mjs
//
// Two halves, for the two ways this stage goes wrong.
//
// `targetDirectory` decides where a phase document lands, and getting it wrong is quiet:
// the file moves, `git log --follow` still works, and it is simply in the wrong place. The
// cases below are every shape the 62-file migration of 2026-08-31 actually produced.
//
// The rest spawns the real script against throwaway fixture trees, following
// `scripts/verify-seam-1.test.mjs:6` — because a suite that only calls the exported helpers
// passes just as happily when the CLI has stopped refusing anything, and that is exactly
// what happened: deleting `assertAllWritable` and its import, the guard's only production
// call site, left the whole suite green.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {batchRefusals, plan, targetDirectory} from './apply.mjs';
import {makeFixture, removeFixture} from './fixture.mjs';

const SCRIPT = fileURLToPath(new URL('./apply.mjs', import.meta.url));

function run(root, ...args) {
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], {
    encoding: 'utf8',
  });
}

function inbox(root, path, text = '# doc\n') {
  mkdirSync(join(root, dirname(path)), {recursive: true});
  writeFileSync(join(root, path), text);
}

function stage(root, ...paths) {
  spawnSync('git', ['add', ...paths], {cwd: root, encoding: 'utf8'});
}

// --- the mapping --------------------------------------------------------------------------

test('a sub-phase document nests under its phase', () => {
  const cases = [
    ['2026-07-28-phase8a-transport-design.md', 'docs/work/mvp/phase8/phase8a'],
    ['2026-07-28-phase8b-async-runtime.md', 'docs/work/mvp/phase8/phase8b'],
    [
      '2026-07-24-phase3a-io-contracts-checklist.md',
      'docs/work/mvp/phase3/phase3a',
    ],
    ['2026-07-26-phase5c-auth.md', 'docs/work/mvp/phase5/phase5c'],
    [
      'docs/superpowers/specs/2026-07-25-phase4b-recovery-chain-design.md',
      'docs/work/mvp/phase4/phase4b',
    ],
  ];
  for (const [name, expected] of cases) {
    assert.equal(targetDirectory(name), expected, name);
  }
});

test('a whole-phase document sits at the phase level, not inside a sub-phase', () => {
  const cases = [
    ['2026-07-28-phase8-segmentation-design.md', 'docs/work/mvp/phase8'],
    [
      '2026-07-26-phase4-execution-context-and-pipelines-checklist.md',
      'docs/work/mvp/phase4',
    ],
    ['2026-07-23-phase1-core-http-domain-model.md', 'docs/work/mvp/phase1'],
    ['2026-07-28-phase10-deviation-reconciliation.md', 'docs/work/mvp/phase10'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(targetDirectory(name), expected, name);
  }
});

test('phase10 is not read as phase1', () => {
  // The reason the whole-phase pattern anchors on `[-.]` after the digits: `\d+` is greedy,
  // but a lazier reading of `-phase1` inside `-phase10-` would file ten phases under one.
  assert.equal(
    targetDirectory('2026-07-28-phase10-deviation-reconciliation-design.md'),
    'docs/work/mvp/phase10',
  );
  assert.notEqual(
    targetDirectory('2026-07-28-phase10-x.md'),
    'docs/work/mvp/phase1',
  );
});

test('the scaffold milestone gets its own directory', () => {
  for (const name of [
    '2026-07-23-scaffold-milestone.md',
    '2026-07-23-scaffold-milestone-design.md',
    '2026-07-23-scaffold-milestone-checklist.md',
  ]) {
    assert.equal(targetDirectory(name), 'docs/work/mvp/scaffold', name);
  }
});

test('a document belonging to no phase sits directly under the delivery', () => {
  assert.equal(
    targetDirectory('2026-07-23-nodejs-sdk-v1-roadmap-design.md'),
    'docs/work/mvp',
  );
  assert.equal(
    targetDirectory('2026-07-25-checkpoint-scaffold-through-phase3a.md'),
    'docs/work/mvp',
  );
});

test('the delivery is a parameter, so a later effort is a sibling of mvp', () => {
  assert.equal(
    targetDirectory('2026-09-01-phase1-x-design.md', 'v2'),
    'docs/work/v2/phase1',
  );
  assert.equal(
    targetDirectory('2026-09-01-phase1a-x-design.md', 'v2'),
    'docs/work/v2/phase1/phase1a',
  );
  assert.equal(targetDirectory('2026-09-01-roadmap.md', 'v2'), 'docs/work/v2');
});

// --- batch refusals ---------------------------------------------------------------------

test('batchRefusals catches two inbox files landing on ONE target', () => {
  const root = makeFixture();
  try {
    const moves = [
      {
        from: 'docs/superpowers/specs/2026-09-01-phase1-x.md',
        to: 'docs/work/mvp/phase1/2026-09-01-phase1-x.md',
      },
      {
        from: 'docs/superpowers/plans/2026-09-01-phase1-x.md',
        to: 'docs/work/mvp/phase1/2026-09-01-phase1-x.md',
      },
    ];
    const refusals = batchRefusals(moves, root);
    assert.equal(refusals.length, 1, JSON.stringify(refusals));
    assert.match(refusals[0], /two inbox files collide on/);
    assert.match(
      refusals[0],
      /specs\/2026-09-01-phase1-x\.md and .*plans\/2026-09-01-phase1-x\.md/,
    );
  } finally {
    removeFixture(root);
  }
});

test('batchRefusals catches a target already in the tree', () => {
  const root = makeFixture({
    overrides: {
      'docs/work/mvp/phase1/2026-09-01-phase1-x.md': '# already here\n',
    },
  });
  try {
    const refusals = batchRefusals(
      [
        {
          from: 'docs/superpowers/specs/2026-09-01-phase1-x.md',
          to: 'docs/work/mvp/phase1/2026-09-01-phase1-x.md',
        },
      ],
      root,
    );
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /already exists/);
  } finally {
    removeFixture(root);
  }
});

// --- the CLI ------------------------------------------------------------------------------

test('an empty inbox collects nothing', () => {
  const root = makeFixture();
  try {
    const {status, stdout} = run(root);
    assert.equal(status, 0);
    assert.match(stdout, /the inbox is empty/);
  } finally {
    removeFixture(root);
  }
});

test('a dry run plans without moving', () => {
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    stage(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    const {status, stdout} = run(root);
    assert.equal(status, 0);
    assert.match(
      stdout,
      /would move .*phase11-thing-design\.md -> docs\/work\/mvp\/phase11\//,
    );
    assert.ok(
      existsSync(
        join(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md'),
      ),
      'a dry run must not move anything',
    );
  } finally {
    removeFixture(root);
  }
});

test('--write performs the move with git mv', () => {
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    stage(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    const {status, stdout} = run(root, '--write');
    assert.equal(status, 0, stdout);
    assert.ok(
      existsSync(
        join(root, 'docs/work/mvp/phase11/2026-09-01-phase11-thing-design.md'),
      ),
    );
    assert.ok(
      !existsSync(
        join(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md'),
      ),
    );
    assert.match(stdout, /did NOT do/);
  } finally {
    removeFixture(root);
  }
});

test('an UNTRACKED inbox file is refused with the git add to run', () => {
  // `git mv` cannot move what git does not track, and the inbox's normal state is exactly
  // that. The old code neither reported nor refused it — `plan()` never saw the file.
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    const {status, stderr} = run(root, '--write');
    assert.equal(status, 1);
    assert.match(stderr, /is not tracked; `git mv` cannot move it/);
    assert.match(
      stderr,
      /run `git add docs\/superpowers\/specs\/2026-09-01-phase11-thing-design\.md`/,
    );
    assert.ok(
      existsSync(
        join(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md'),
      ),
    );
  } finally {
    removeFixture(root);
  }
});

test('two same-basename inbox files are refused BEFORE anything moves', () => {
  // Reproduced end to end before the fix: the dry run printed "2 move(s) planned", `--write`
  // performed the first, then `git mv` fatalled with an uncaught stack and a half-applied
  // index. `specs/` and `plans/` are the two directories the inbox actually uses.
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing.md');
    inbox(root, 'docs/superpowers/plans/2026-09-01-phase11-thing.md');
    stage(
      root,
      'docs/superpowers/specs/2026-09-01-phase11-thing.md',
      'docs/superpowers/plans/2026-09-01-phase11-thing.md',
    );

    const {status, stderr} = run(root, '--write');
    assert.equal(status, 1, 'the batch must be refused');
    assert.match(stderr, /two inbox files collide on/);
    assert.ok(
      existsSync(
        join(root, 'docs/superpowers/specs/2026-09-01-phase11-thing.md'),
      ) &&
        existsSync(
          join(root, 'docs/superpowers/plans/2026-09-01-phase11-thing.md'),
        ),
      'nothing may move when the batch is refused',
    );
    assert.ok(
      !existsSync(join(root, 'docs/work/mvp/phase11')),
      'no target may be created',
    );
  } finally {
    removeFixture(root);
  }
});

test('a delivery that escapes into a frozen tree is refused by the guard', () => {
  // The guard's only production call site. Deleting it left every other test green.
  const root = makeFixture({
    overrides: {'docs/product-spec/04-core.md': '# normative\n'},
  });
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    stage(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');

    const {status, stderr} = run(root, '--write', '--delivery=../product-spec');
    assert.notEqual(status, 0, 'a frozen destination must not be written');
    assert.match(stderr, /FrozenPathError/);
    assert.match(stderr, /refusing to write/);
    assert.ok(
      existsSync(
        join(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md'),
      ),
      'nothing may move when the guard refuses',
    );
  } finally {
    removeFixture(root);
  }
});

// --- plan() -------------------------------------------------------------------------------

test('the plan keeps the filename, date prefix included', () => {
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    inbox(root, 'docs/superpowers/plans/2026-09-01-roadmap-v2.md');
    stage(root, 'docs/superpowers');

    const moves = plan('mvp', root);
    assert.equal(moves.length, 2, JSON.stringify(moves));
    for (const {from, to} of moves) {
      assert.equal(to.split('/').pop(), from.split('/').pop(), from);
      assert.ok(to.startsWith('docs/work/mvp/'), to);
    }
  } finally {
    removeFixture(root);
  }
});

test('plan() sees an UNTRACKED inbox file', () => {
  const root = makeFixture();
  try {
    inbox(root, 'docs/superpowers/specs/2026-09-01-phase11-thing-design.md');
    assert.equal(plan('mvp', root).length, 1);
  } finally {
    removeFixture(root);
  }
});

test('the inbox README is never collected', () => {
  const root = makeFixture();
  try {
    assert.deepEqual(plan('mvp', root), []);
  } finally {
    removeFixture(root);
  }
});
