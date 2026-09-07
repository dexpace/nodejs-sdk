// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/apply.mjs
//
// The only stage that writes. It does exactly one mechanical thing — drain the
// `docs/superpowers/` inbox into `docs/work/<delivery>/phaseN/` with `git mv`, so history
// follows each file — and refuses everything else.
//
//   node .claude/skills/housekeeping/apply.mjs                 # dry run, prints the plan
//   node .claude/skills/housekeeping/apply.mjs --write         # performs it
//   node .claude/skills/housekeeping/apply.mjs --write --delivery=v2
//   node .claude/skills/housekeeping/apply.mjs --root=/fixture # for the tests
//
// Everything the probe reports that is NOT a file move — a stale count in `CLAUDE.md`, a
// missing package README, a broken link — is prose, and prose is edited by whoever ran the
// probe. A tool that rewrites a sentence to make its own check pass is how documentation
// becomes true and useless at the same time.

import {existsSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAllWritable} from './guard.mjs';

function resolveRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: here,
    encoding: 'utf8',
  }).trim();
}

function git(root, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

/**
 * Where a phase document belongs, from its own name.
 *
 * `2026-07-28-phase8a-transport-design.md` → `phase8/phase8a/`. A file naming a whole phase
 * with no sub-phase letter — a segmentation design, a shared checklist — sits at the
 * `phaseN/` level. A file naming no phase at all sits directly under the delivery.
 *
 * Exported for the tests: the mapping is the part of this stage that can be wrong quietly.
 */
export function targetDirectory(filename, delivery = 'mvp') {
  const base = posix.basename(filename);
  const sub = /-phase(\d+)([a-z])-/.exec(base);
  if (sub)
    return `docs/work/${delivery}/phase${sub[1]}/phase${sub[1]}${sub[2]}`;
  const whole = /-phase(\d+)[-.]/.exec(base);
  if (whole) return `docs/work/${delivery}/phase${whole[1]}`;
  if (/-scaffold-milestone/.test(base)) return `docs/work/${delivery}/scaffold`;
  return `docs/work/${delivery}`;
}

/**
 * The inbox, tracked and untracked alike.
 *
 * `--others --exclude-standard` is the point: the inbox's NORMAL state is a file
 * `brainstorming` has just written and nobody has staged. A tracked-only listing reported
 * "the inbox is empty" over exactly the case this stage exists for.
 */
function inboxFiles(root) {
  return git(
    root,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'docs/superpowers/**',
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(f => posix.basename(f) !== 'README.md');
}

/** Which of `files` git does not track yet. `git mv` cannot move those. */
function untrackedAmong(root, files) {
  if (files.length === 0) return [];
  const cached = new Set(
    git(root, 'ls-files', '--cached', '--', 'docs/superpowers/**')
      .trim()
      .split('\n')
      .filter(Boolean),
  );
  return files.filter(f => !cached.has(f));
}

/** The moves this run would perform, unperformed. */
export function plan(delivery = 'mvp', root = resolveRepoRoot()) {
  return inboxFiles(root).map(from => ({
    from,
    to: posix.join(targetDirectory(from, delivery), posix.basename(from)),
  }));
}

/**
 * Every reason this batch cannot be performed, as messages.
 *
 * Two collision classes, not one. `existsSync` catches a target already in the tree; the
 * `seen` map catches two inbox files that land on the SAME target — which is the likely
 * one, because `specs/` and `plans/` are the two directories the inbox actually uses and a
 * design and its plan can share a basename. Without it the dry run printed "2 move(s)
 * planned" and `--write` performed the first, then died on `git mv: destination exists`
 * with an uncaught stack and a half-applied index.
 *
 * Exported so the tests can drive it without moving anything.
 */
export function batchRefusals(moves, root) {
  const refusals = [];
  const seen = new Map();
  for (const move of moves) {
    if (seen.has(move.to)) {
      refusals.push(
        `two inbox files collide on ${move.to}: ${seen.get(move.to)} and ${move.from}. ` +
          'Rename one before collecting; the date prefix is what usually differs.',
      );
      continue;
    }
    seen.set(move.to, move.from);
    if (existsSync(join(root, move.to))) {
      refusals.push(`${move.to} already exists (from ${move.from})`);
    }
  }
  return refusals;
}

function main(argv) {
  const write = argv.includes('--write');
  const deliveryArg = argv.find(a => a.startsWith('--delivery='));
  const delivery = deliveryArg?.slice('--delivery='.length) ?? 'mvp';
  const rootArg = argv.find(a => a.startsWith('--root='));
  const root = rootArg?.slice('--root='.length) ?? resolveRepoRoot();

  const moves = plan(delivery, root);
  if (moves.length === 0) {
    process.stdout.write('the inbox is empty; nothing to collect.\n');
    return 0;
  }

  // Guard the WHOLE batch before performing any of it, so a refusal cannot leave the tree
  // between two states. `--delivery=../product-spec` is what this stops.
  assertAllWritable(
    moves.flatMap(m => [m.from, m.to]),
    root,
  );

  const untracked = untrackedAmong(
    root,
    moves.map(m => m.from),
  );
  if (untracked.length > 0) {
    for (const file of untracked) {
      process.stderr.write(
        `refusing: ${file} is not tracked; \`git mv\` cannot move it\n`,
      );
    }
    process.stderr.write(
      `run \`git add ${untracked.join(' ')}\` first, then re-run. A phase document is worth ` +
        'a commit of its own before it moves, so history follows it across the collection.\n',
    );
    return 1;
  }

  const refusals = batchRefusals(moves, root);
  if (refusals.length > 0) {
    for (const message of refusals)
      process.stderr.write(`refusing: ${message}\n`);
    return 1;
  }

  const done = [];
  try {
    for (const {from, to} of moves) {
      process.stdout.write(
        `${write ? 'git mv' : '  would move'} ${from} -> ${to}\n`,
      );
      if (!write) continue;
      mkdirSync(join(root, dirname(to)), {recursive: true});
      git(root, 'mv', from, to);
      done.push(`${from} -> ${to}`);
    }
  } catch (error) {
    // A mid-batch failure must say how far it got. Without this the operator is left with a
    // raw stack and an index in an unknown state.
    process.stderr.write(
      `\n${String(done.length)} of ${String(moves.length)} move(s) were performed before ` +
        'this failed:\n',
    );
    for (const line of done) process.stderr.write(`  ${line}\n`);
    process.stderr.write(
      `\n${error instanceof Error ? error.message : String(error)}\n` +
        'The tree is half-collected. `git status` shows the completed moves; finish or ' +
        'revert them before re-running.\n',
    );
    return 1;
  }

  if (!write) {
    process.stdout.write(
      `\n${String(moves.length)} move(s) planned. Re-run with --write to perform them.\n`,
    );
    return 0;
  }

  process.stdout.write(
    `\n${String(moves.length)} file(s) collected. Two things this stage did NOT do:\n` +
      "  1. Repoint references to the old paths. Run the probe's link and citation checks,\n" +
      '     then fix what they report — in the same commit, per documentation.md:34.\n' +
      '  2. Commit. A migration is its own commit, git mv only, so `git log --follow` works.\n',
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
