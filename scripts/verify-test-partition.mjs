// SPDX-License-Identifier: MIT
// scripts/verify-test-partition.mjs
//
// Guards the separation between the two suites under `tests/`. The rule itself, and the reasoning
// behind it, live in ONE place: CLAUDE.md, "HARD RULE -- the `tests/` partition". This file is the
// enforcement, not a second copy of the argument.
//
// In one sentence: `tests/conformance/` runs on Bun as part of `bun run test`,
// `tests/node-conformance/` runs on `node --test` against the built `dist/`, and nothing may make
// the second run on the first's runner. Until Phase 10 the file system held that -- the Node tree
// lived at `test/`, where no Bun command could reach it. It now lives inside `tests/`, so a path
// written into five files holds it instead, and those five must agree.
//
// Reads files only. Runs neither suite.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const BUNFIG = 'bunfig.toml';
const PACKAGE_JSON = 'package.json';
const ESLINT_CONFIG = 'eslint.config.js';
const RUN_CI = '.claude/skills/ci-preflight/run-ci.mjs';
const README = 'tests/node-conformance/README.md';

const TESTS_ROOT = 'tests';
const NODE_TREE = 'tests/node-conformance';
const PACKAGES_ROOT = 'packages';

// Bun ignores an unrecognized `[test]` key in silence -- no warning, no error, no effect. This is
// the key that works; the decoy is the near-miss that reads as configured and is not.
const IGNORE_KEY = 'pathIgnorePatterns';
const DECOY_IGNORE_KEY = 'testPathIgnorePatterns';
const EXPECTED_BUN_ROOT = 'packages';

// `run-ci.mjs`'s `--node-floor` leg repeats the runner glob once per version manager it supports
// (mise, fnm, nvm). A minimum rather than an exact count: adding a fourth manager is fine, losing
// one silently is not.
const RUN_CI_MIN_GLOBS = 3;

// --- path and glob primitives -------------------------------------------------------------------

/**
 * @param {string} segment one path segment, no separators
 * @returns {string} regexp source
 */
function segmentToRegExp(segment) {
  let out = '';
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/**
 * Translate a shell-style glob to an anchored RegExp over POSIX-separated, repo-relative paths.
 *
 * `**` spans whole path segments and only as a whole segment, which is what Bun does: Bun does not
 * ignore `tests/wideZa.test.mjs` for a pattern whose last segment is `Za.test.mjs` behind a `**`.
 * An earlier draft compiled `**` to a bare `.*` everywhere and matched it -- the dangerous
 * direction for a gate, green-lighting a config Bun reads differently. Within a segment, `*` and
 * `?` stop at the separator; everything else is a literal.
 *
 * Deliberately small. No brace expansion, no character classes, no extglob -- Bun expands those and
 * this does not, so such a pattern fails the gate rather than passing it wrongly. If one is ever
 * needed, that is the signal to reach for a real matcher, not to grow this.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  const segments = glob.split('/');
  let out = '^';
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    if (segments[i] === '**') {
      // Zero or more whole segments. A trailing `**` also matches an empty remainder.
      out += isLast ? '(?:[^/]+(?:/[^/]+)*)?' : '(?:[^/]+/)*';
      continue;
    }
    out += segmentToRegExp(segments[i]);
    if (!isLast) out += '/';
  }
  return new RegExp(`${out}$`);
}

/**
 * `a/b/c.mjs` -> `['a', 'a/b', 'a/b/c.mjs']`.
 *
 * @param {string} file
 * @returns {string[]}
 */
function pathPrefixes(file) {
  const parts = file.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/**
 * Would Bun skip this file for these patterns?
 *
 * Every directory prefix counts, not just the full path. Bun applies `pathIgnorePatterns` while
 * WALKING, so a pattern naming a directory prunes that whole subtree without matching any file path
 * -- measured: adding `tests/conformance/fixtures` to the list dropped `fixtures/settle.test.mjs`
 * from the run. Testing full paths alone left the widening check below blind to exactly the pattern
 * shape a maintainer reaches for first. It is also what makes a bare `tests/node-conformance` (no
 * `/**`) read as covering the tree, which is what Bun does with it.
 *
 * @param {string} file repo-relative POSIX path
 * @param {RegExp[]} matchers
 * @returns {boolean}
 */
function isIgnored(file, matchers) {
  return pathPrefixes(file).some(prefix =>
    matchers.some(matcher => matcher.test(prefix)),
  );
}

// --- source readers -----------------------------------------------------------------------------

/**
 * Every file under `dir`, as repo-relative POSIX paths.
 *
 * `withFileTypes` rather than a `statSync` per entry: `statSync` throws on a broken symlink, and an
 * uncaught `ENOENT` stack trace is the least useful thing a gate can emit. A directory that is
 * genuinely absent returns `[]`, and the caller reports that as its own violation; anything else --
 * a permission error, a descriptor limit -- propagates, because "unreadable" recovered to "empty"
 * is a wrong diagnosis rather than a known-good state.
 *
 * @param {string} root
 * @param {string} dir repo-relative
 * @returns {string[]}
 */
function listFiles(root, dir) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFiles(root, child));
    else found.push(child);
  }
  return found.sort();
}

/**
 * Blank out a `#` comment, respecting quoted strings.
 *
 * A naive `/#.*$/` corrupts `pathIgnorePatterns = ["tests/#node/**"]` into an unterminated line,
 * whose array then swallows the rest of the section.
 *
 * @param {string} line
 * @returns {string}
 */
function stripTomlComment(line) {
  let out = '';
  let quote = null;
  for (const ch of line) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '#') {
      break;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Is the offset inside a JS comment?
 *
 * Line-scoped on purpose. The obvious implementation -- blank out `/*...*\/` and `//...` over the
 * whole source, as `verify-sse-37.mjs` does -- is wrong for THESE files specifically, because the
 * strings they hold are globs: `packages/*\/scripts/*.mjs` contains `/*` and then `*\/`, so a
 * block-comment matcher treats the middle of the `files:` array as a comment and deletes the very
 * entry this gate exists to find. Looking only at what precedes the match on its own line cannot
 * make that mistake.
 *
 * @param {string} source
 * @param {number} index
 * @returns {boolean}
 */
function isCommented(source, index) {
  const prefix = source.slice(source.lastIndexOf('\n', index) + 1, index);
  return (
    prefix.includes('//') || prefix.includes('/*') || /^\s*\*/.test(prefix)
  );
}

/**
 * The array `key` holds inside TOML section `[section]`.
 *
 * Hand-rolled rather than a TOML dependency: the gate must run with none, and the question is
 * narrow -- is this exact key declared in this exact section, and what does it hold.
 *
 * @param {string} source
 * @param {string} section
 * @param {string} key
 * @returns {{declared: boolean, malformed: boolean, values: string[]}}
 */
function readTomlStringArray(source, section, key) {
  const lines = source.split('\n').map(line => stripTomlComment(line).trim());
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    const header = /^\[([^\]]+)\]$/.exec(lines[i]);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== section) continue;
    const assignment = new RegExp(`^${key}\\s*=\\s*(.*)$`).exec(lines[i]);
    if (!assignment) continue;
    let raw = assignment[1];
    // Tolerate an array spread over several lines, but stop at anything starting a new key or
    // section -- otherwise an unterminated array silently absorbs the next key's value.
    while (!raw.includes(']') && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^\[/.test(next) || /^[\w.-]+\s*=/.test(next)) break;
      raw += lines[++i];
    }
    if (!raw.includes(']'))
      return {declared: true, malformed: true, values: []};
    return {
      declared: true,
      malformed: false,
      values: [...raw.matchAll(/["']([^"']*)["']/g)].map(match => match[1]),
    };
  }
  return {declared: false, malformed: false, values: []};
}

/**
 * The string `key` holds inside TOML section `[section]`, or null.
 *
 * @param {string} source
 * @param {string} section
 * @param {string} key
 * @returns {string | null}
 */
function readTomlString(source, section, key) {
  let current = '';
  for (const line of source.split('\n').map(l => stripTomlComment(l).trim())) {
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== section) continue;
    const found = new RegExp(`^${key}\\s*=\\s*["']([^"']*)["']`).exec(line);
    if (found) return found[1];
  }
  return null;
}

/**
 * Path-shaped globs naming the Node tree, lifted out of an arbitrary source. Occurrences, not a
 * set: the caller decides whether repetition is meaningful.
 *
 * Requires a `*`, which is what separates a glob from prose -- `run-ci.mjs` carries
 * `node-conformance (matrix)` as a CI step label, and that is not a pattern anything matches
 * against. The consequence is that a hard-coded, star-free path slips past, which is acceptable: a
 * literal path either resolves or visibly does not, whereas a glob matching nothing fails open.
 *
 * `skipComments` is what stops a source file from satisfying the check with prose ABOUT its own
 * glob: `eslint.config.js`'s comment quotes the `files:` entry beneath it, and without this the
 * check stayed green after that entry was deleted -- the sentence explaining the guarantee was what
 * voided it. Markdown passes `false`, since there the prose IS the artifact.
 *
 * @param {string} source
 * @param {boolean} [skipComments]
 * @returns {string[]}
 */
function extractNodeTreeGlobs(source, skipComments = false) {
  const found = [];
  for (const match of source.matchAll(
    /[\w.*/-]*\/node-conformance\/[\w.*/-]+/g,
  )) {
    if (!match[0].includes('*')) continue;
    if (skipComments && isCommented(source, match.index)) continue;
    found.push(match[0]);
  }
  return found;
}

/**
 * @typedef {object} PartitionSources
 * @property {string} bunfig
 * @property {string} packageJson
 * @property {string} eslintConfig
 * @property {string} runCi
 * @property {string} readme
 * @property {string[]} nodeTreeFiles repo-relative POSIX paths under tests/node-conformance/
 * @property {string[]} bunTreeFiles everything else under tests/ that a runner would collect
 * @property {string[]} packageFiles colocated unit tests under packages/
 */

/**
 * Read every file and tree the checks operate on.
 *
 * Separated from the checks so `findPartitionViolations` is pure and TOTAL: a caller supplies the
 * whole world or none of it, never a mixture that silently reads live repo state it never named.
 *
 * @param {string} [root]
 * @returns {PartitionSources}
 */
export function readPartitionSources(root = REPO_ROOT) {
  const read = name => readFileSync(join(root, name), 'utf8');
  const underTests = listFiles(root, TESTS_ROOT);
  const inNodeTree = file => file.startsWith(`${NODE_TREE}/`);
  return {
    bunfig: read(BUNFIG),
    packageJson: read(PACKAGE_JSON),
    eslintConfig: read(ESLINT_CONFIG),
    runCi: read(RUN_CI),
    readme: read(README),
    nodeTreeFiles: underTests.filter(inNodeTree),
    // Everything else under `tests/`, rather than a hardcoded sibling: check 4 has to stay
    // meaningful if `tests/conformance/` is renamed, and it covers any future `tests/<other>/`
    // for free.
    bunTreeFiles: underTests.filter(
      file => !inNodeTree(file) && /\.(?:ts|tsx|mjs|cjs|js)$/.test(file),
    ),
    packageFiles: listFiles(root, PACKAGES_ROOT).filter(file =>
      file.endsWith('.test.ts'),
    ),
  };
}

// --- the checks ---------------------------------------------------------------------------------

/** Check 1 — the bunfig key exists, under [test], and is not the silent near-miss. */
function checkIgnoreKeyDeclared(sources, ignore, fail) {
  // Declaration-only, so `bunfig.toml` stays free to NAME the near-miss in a comment. A raw
  // substring scan made the one file where that warning belongs the one file forbidden to carry it.
  if (readTomlStringArray(sources.bunfig, 'test', DECOY_IGNORE_KEY).declared) {
    fail(
      1,
      `${BUNFIG} declares \`${DECOY_IGNORE_KEY}\`. Bun does not read that key and does not warn` +
        ` about it; the run then collects ${NODE_TREE}/ and reports it passing. The key is` +
        ` \`${IGNORE_KEY}\`.`,
    );
  }
  if (ignore.malformed) {
    fail(1, `${BUNFIG}'s \`[test] ${IGNORE_KEY}\` array is not terminated.`);
  } else if (!ignore.declared) {
    fail(
      1,
      `${BUNFIG} has no \`${IGNORE_KEY}\` key under [test]. Without it, \`bun test ./tests\`` +
        ` collects ${NODE_TREE}/ and reports node:test files as passing.`,
    );
  } else if (ignore.values.length === 0) {
    fail(1, `${BUNFIG}'s \`[test] ${IGNORE_KEY}\` is empty.`);
  }
}

/** Check 2 — every file in the Node tree is kept out of `bun test`. */
function checkNodeTreeIgnored(sources, globs, matchers, fail) {
  if (sources.nodeTreeFiles.length === 0) {
    fail(
      2,
      `${NODE_TREE}/ holds no files. The Node suite is the only thing that runs on Node.`,
    );
  }
  for (const file of sources.nodeTreeFiles) {
    if (!isIgnored(file, matchers)) {
      fail(
        2,
        `${file} is not matched by \`[test] ${IGNORE_KEY}\` (${globs.join(', ')}), so` +
          ' `bun run test` collects it.',
      );
    }
  }
}

/** Check 4 — nothing Bun is supposed to run is caught by the ignore glob. */
function checkOtherTreesNotIgnored(sources, globs, matchers, fail) {
  if (sources.bunTreeFiles.length === 0) {
    fail(
      4,
      `${TESTS_ROOT}/ holds no Bun-runner files outside ${NODE_TREE}/. Either the Bun suite moved` +
        ' or it is gone; either way this check has stopped meaning anything.',
    );
  }
  for (const file of [...sources.bunTreeFiles, ...sources.packageFiles]) {
    if (isIgnored(file, matchers)) {
      fail(
        4,
        `${file} IS matched by \`[test] ${IGNORE_KEY}\` (${globs.join(', ')}), so \`bun run test\`` +
          ' silently skips it.',
      );
    }
  }
}

/** Check 3 — every file in the Node tree is either the README or reached by `test:node`. */
function checkRunnerReachesEveryCase(sources, fail) {
  const testNode = JSON.parse(sources.packageJson).scripts?.['test:node'];
  if (typeof testNode !== 'string') {
    fail(3, `${PACKAGE_JSON} has no \`test:node\` script.`);
    return;
  }
  const globs = testNode.split(/\s+/).filter(token => token.endsWith('.mjs'));
  if (globs.length === 0) {
    fail(3, `\`test:node\` names no .mjs path: ${testNode}`);
    return;
  }
  const matchers = globs.map(globToRegExp);
  for (const file of sources.nodeTreeFiles) {
    if (file === README || matchers.some(matcher => matcher.test(file))) {
      continue;
    }
    fail(
      3,
      `${file} is not matched by \`test:node\` (${globs.join(', ')}), so no command in the repo` +
        ' runs it. `node --test` over a glob matching nothing exits 0, so this is silent.',
    );
  }
}

/** Check 5 — every Node-tree glob the other four files carry still reaches the whole suite. */
function checkDocumentedGlobs(sources, fail) {
  const cases = sources.nodeTreeFiles.filter(file =>
    file.endsWith('.test.mjs'),
  );
  const sites = [
    [RUN_CI, sources.runCi, true, RUN_CI_MIN_GLOBS],
    [ESLINT_CONFIG, sources.eslintConfig, true, 1],
    // Prose, not code: the README names the tree to its reader, so its comments are not skipped.
    [README, sources.readme, false, 1],
  ];
  for (const [name, source, skipComments, minimum] of sites) {
    const globs = extractNodeTreeGlobs(source, skipComments);
    if (globs.length < minimum) {
      fail(
        5,
        `${name} carries ${globs.length} ${NODE_TREE}/ glob(s), expected at least ${minimum}.` +
          ' Losing one fails open.',
      );
    }
    for (const glob of new Set(globs)) {
      const matcher = globToRegExp(glob);
      const missed = cases.filter(file => !matcher.test(file));
      if (missed.length > 0) {
        fail(
          5,
          `${name}'s glob \`${glob}\` misses ${missed.length} of ${cases.length} cases under` +
            ` ${NODE_TREE}/, starting with ${missed[0]}.`,
        );
      }
    }
  }
}

/** Checks 6 and 7 — the two further things CLAUDE.md's hard rule tells the reader to keep. */
function checkRootScriptAndBunRoot(sources, fail) {
  const test = JSON.parse(sources.packageJson).scripts?.test;
  // Whole arguments, never a substring: `bun test ./packages ./tests/conformance` CONTAINS
  // `./tests` while being precisely the narrowing the hard rule forbids -- it protects the root
  // script and leaves a hand-typed `bun test ./tests` collecting the Node suite.
  const args = typeof test === 'string' ? test.split(/\s+/) : [];
  if (typeof test !== 'string') {
    fail(6, `${PACKAGE_JSON} has no \`test\` script.`);
  } else if (
    !args.includes(`./${PACKAGES_ROOT}`) ||
    !args.includes(`./${TESTS_ROOT}`)
  ) {
    fail(
      6,
      `\`test\` must pass both trees whole (\`./${PACKAGES_ROOT} ./${TESTS_ROOT}\`); it is` +
        ` \`${test}\`. A bare \`bun test\` never visits ${TESTS_ROOT}/, and narrowing to a subtree` +
        ` protects only this script -- a hand-typed \`bun test ./${TESTS_ROOT}\` still collects` +
        ` ${NODE_TREE}/.`,
    );
  }
  const root = readTomlString(sources.bunfig, 'test', 'root');
  if (root !== EXPECTED_BUN_ROOT) {
    fail(
      7,
      `${BUNFIG}'s \`[test] root\` is ${root === null ? 'absent' : `"${root}"`}, expected` +
        ` "${EXPECTED_BUN_ROOT}". It scopes a bare \`bun test\` and keeps scripts/*.test.mjs out of` +
        " that run's coverage floor.",
    );
  }
}

/**
 * Checks 1-5 are issue #55's. 6 and 7 guard two further rules CLAUDE.md's hard rule states and
 * nothing enforced: the root script must name both trees, and `[test] root` must stay `"packages"`.
 *
 * @param {PartitionSources} sources
 * @returns {{check: number, message: string}[]} empty when the partition holds
 */
export function findPartitionViolations(sources) {
  const violations = [];
  const fail = (check, message) => violations.push({check, message});

  const ignore = readTomlStringArray(sources.bunfig, 'test', IGNORE_KEY);
  checkIgnoreKeyDeclared(sources, ignore, fail);
  if (ignore.declared && !ignore.malformed) {
    const matchers = ignore.values.map(globToRegExp);
    checkNodeTreeIgnored(sources, ignore.values, matchers, fail);
    checkOtherTreesNotIgnored(sources, ignore.values, matchers, fail);
  }
  checkRunnerReachesEveryCase(sources, fail);
  checkDocumentedGlobs(sources, fail);
  checkRootScriptAndBunRoot(sources, fail);

  return violations;
}

// --- CLI -----------------------------------------------------------------------------------------

const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  const violations = findPartitionViolations(readPartitionSources());
  if (violations.length > 0) {
    for (const {check, message} of violations) {
      console.error(`test-partition violation (check ${check}): ${message}`);
    }
    console.error(
      `\nThe ${TESTS_ROOT}/conformance/ and ${NODE_TREE}/ suites must never run together. Five` +
        ` files hold that apart and they must agree: ${BUNFIG}, ${PACKAGE_JSON},` +
        ` ${ESLINT_CONFIG}, ${RUN_CI}, and ${README}. Change one, then change all of them. See` +
        ' CLAUDE.md, "HARD RULE -- the `tests/` partition".',
    );
    process.exit(1);
  }
  console.log(
    `test-partition OK: ${BUNFIG}, ${PACKAGE_JSON}, ${ESLINT_CONFIG}, ${RUN_CI} and ${README}` +
      ` agree on ${NODE_TREE}/, and nothing else under ${TESTS_ROOT}/ is caught by the ignore glob.`,
  );
}
