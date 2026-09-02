// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/guard.mjs
//
// The frozen-path guard. Three trees and two files in `docs/` are read-only to this
// skill, and that has to be a check rather than a paragraph of good intent: the apply
// stage moves files and rewrites Markdown, and a glob that widens by one segment is
// exactly how a maintenance tool eats a normative document.
//
// Every write the skill performs goes through `assertWritable` first. `guard.test.mjs`
// is what proves it, including the three ways a naive prefix test gets it wrong: a
// sibling whose name merely starts with a frozen one, a `..` segment that lands inside
// after normalization, and an absolute path.

import {realpathSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';

/**
 * The five entries this skill must never write to.
 *
 * `docs/knowledge/` covers both `harvested/` and `notes/`. `harvested/` cannot absorb a
 * hand edit at all — a `<sub>` sha digests the whole source file rather than the entry, so
 * an edit inside one changes no sha and the next harvest regenerates or duplicates it
 * silently. `notes/` is hand-written and could in principle be edited; it is frozen here
 * because the CLI reads the two as one corpus and a note's key citation couples them.
 * Whether that grouping is right is `docs/open-items.md` U1.
 */
export const FROZEN = Object.freeze([
  'docs/knowledge',
  'docs/product-spec',
  'docs/sdk-design-nodejs',
  'docs/product-spec.md',
  'docs/sdk-design-nodejs.md',
]);

/** Raised instead of writing. Carries the offending path so a caller can report it. */
export class FrozenPathError extends Error {
  constructor(path, frozen) {
    super(
      `refusing to write ${path}: it is under the frozen entry '${frozen}'. ` +
        'The housekeeping skill reads the normative and harvested trees; it never ' +
        'writes to them. See docs/README.md.',
    );
    this.name = 'FrozenPathError';
    this.path = path;
    this.frozen = frozen;
  }
}

/**
 * `path` with every symlink in it resolved, as far as the filesystem actually goes.
 *
 * `resolve()` is purely lexical, so on its own it answers the wrong question: with
 * `docs/work` a symlink to `docs/product-spec`, `docs/work/mvp/x.md` lexically escapes the
 * frozen tree and physically lands inside it — and `mkdirSync(…, {recursive: true})`
 * follows the link, so a `git mv` would write there while the guard said yes.
 *
 * A target that does not exist yet is the normal case for a move, so this walks up to the
 * nearest ancestor that does, resolves that, and re-attaches the tail.
 */
function realpathOfNearestAncestor(path) {
  const segments = [];
  let current = path;
  for (;;) {
    try {
      return resolve(realpathSync.native(current), ...segments.reverse());
    } catch {
      const parent = dirname(current);
      // Root reached without anything existing: nothing to resolve, answer lexically.
      if (parent === current) return path;
      segments.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Which frozen entry `candidate` falls under, or `null`.
 *
 * Resolved against `repoRoot` and compared **segment-wise**, never as a raw string
 * prefix: `docs/product-spec-draft/x.md` starts with `docs/product-spec` as characters
 * and is not under it as a path. `..` is normalized away first, so a path that spells its
 * way in cannot spell its way past the check — and symlinks are resolved, so a path that
 * *links* its way in cannot either.
 */
export function frozenEntryFor(candidate, repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const target = realpathOfNearestAncestor(resolve(root, candidate));
  for (const entry of FROZEN) {
    const frozenAbs = realpathOfNearestAncestor(resolve(root, entry));
    if (target === frozenAbs) return entry;
    const rel = relative(frozenAbs, target);
    // Inside iff the relative path neither escapes upward nor is absolute.
    if (
      rel !== '' &&
      !rel.startsWith(`..${sep}`) &&
      rel !== '..' &&
      !rel.startsWith(sep)
    ) {
      return entry;
    }
  }
  return null;
}

/** `true` when `candidate` is a frozen entry or lives under one. */
export function isFrozen(candidate, repoRoot = process.cwd()) {
  return frozenEntryFor(candidate, repoRoot) !== null;
}

/**
 * Throws `FrozenPathError` when `candidate` is frozen; returns it otherwise, so a call
 * site reads `writeFileSync(assertWritable(p), text)` and cannot forget the check.
 */
export function assertWritable(candidate, repoRoot = process.cwd()) {
  const frozen = frozenEntryFor(candidate, repoRoot);
  if (frozen !== null) throw new FrozenPathError(candidate, frozen);
  return candidate;
}

/**
 * Guards a whole batch before performing any of it, so a run cannot half-apply and leave
 * the tree between two states.
 */
export function assertAllWritable(candidates, repoRoot = process.cwd()) {
  const refused = candidates
    .map(path => ({path, frozen: frozenEntryFor(path, repoRoot)}))
    .filter(({frozen}) => frozen !== null);
  if (refused.length > 0) {
    throw new FrozenPathError(refused[0].path, refused[0].frozen);
  }
  return candidates;
}
