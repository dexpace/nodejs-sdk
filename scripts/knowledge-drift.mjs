// SPDX-License-Identifier: MIT
// scripts/knowledge-drift.mjs
//
// Reports what has gone stale in `docs/knowledge/`, in two dimensions:
//
//   sources — every sha256 recorded in `harvested/SOURCES.md` against the file
//             on disk, so you can see which harvested entries describe a
//             document that has since changed.
//   keys    — every `<topic>/<8 hex>` a note cites, against the corpus, so you
//             can see which notes name a rule whose text no longer exists. A
//             key digests entry text; a re-harvest that rewords a rule breaks
//             the citation, and that is precisely when the note needs revisiting.
//
// Named for its subject rather than a verb, like `knowledge.mjs` and
// `changeset.mjs`: the `verify-*.mjs` prefix in this directory belongs to the
// blocking gates, and this is a report.
//
// A report, not a gate, and deliberately not in CI: no drift state fails it.
// (A manifest that is missing or malformed still exits 2 — that is the report
// being unable to run, not a state it reports.) Two reasons. The styleguide
// root is a sibling repository addressed by an absolute path on the harvest
// machine, so 16 of the sources simply do not exist in a CI checkout — they are
// NOT VERIFIABLE, never a failure. And drift is normal: a design chapter that a
// phase edits to record an outcome SHOULD drift, and the fix is a re-harvest,
// which is a user-invoked skill rather than something CI can do.
//
// The states are OK, DRIFT, NOT VERIFIABLE and UNREADABLE.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  danglingKeys,
  derivePrefixes,
  loadCanonicalIds,
  loadCorpus,
} from './knowledge.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sourcesPath = join(
  repoRoot,
  'docs',
  'knowledge',
  'harvested',
  'SOURCES.md',
);

// `| \`path\` | role | \`sha\` | date |` — the sha cell sometimes carries an
// annotation after the digest, so take the first backticked token in it.
const SOURCE_ROW = /^\|\s*`([^`]+)`\s*\|\s*([^|]*?)\s*\|\s*`([0-9a-f]+)`/;
// Any data row of the manifest table, parseable or not. Counting these is what
// turns "47 sources OK" from a count of rows that happened to match into a
// statement about the table: a row with an upper-case or empty digest used to
// vanish, and the summary line reported the smaller number as if it were all.
const ANY_ROW = /^\|\s*`([^`]+)`\s*\|/;
// A digest short enough to collide by accident is not a pin. The manifest
// records 12 hex; comparing at the recorded width alone would let a truncated
// row compare clean forever.
const MIN_SHA_LENGTH = 12;

function parseSources(text) {
  const rows = [];
  let listed = 0;
  for (const line of text.split('\n')) {
    if (!ANY_ROW.test(line)) continue;
    listed += 1;
    const match = SOURCE_ROW.exec(line);
    if (match) rows.push({path: match[1], role: match[2], sha: match[3]});
  }
  if (rows.length === 0) {
    throw new Error(
      `parsed zero source rows out of ${sourcesPath}; its table format changed`,
    );
  }
  if (rows.length < listed) {
    throw new Error(
      `${sourcesPath} lists ${listed} sources but only ${rows.length} parse; ` +
        'the rest carry a malformed digest cell and would be silently skipped',
    );
  }
  for (const row of rows) {
    if (row.sha.length >= MIN_SHA_LENGTH) continue;
    throw new Error(
      `${row.path} is pinned to a ${row.sha.length}-character digest; at least ` +
        `${MIN_SHA_LENGTH} are needed for the comparison to mean anything`,
    );
  }
  return rows;
}

// The manifest records a truncated digest, so compare at the recorded width.
//
// Only ENOENT is NOT VERIFIABLE. An unreadable or wrong-typed path reported as
// "not present" would hide inside the one state this report teaches the reader
// to ignore — off the harvest machine, 16 sources are legitimately absent.
function stateOf(row) {
  let bytes;
  try {
    bytes = readFileSync(
      row.path.startsWith('/') ? row.path : join(repoRoot, row.path),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return {state: 'NOT VERIFIABLE', actual: null};
    return {state: 'UNREADABLE', actual: null, detail: error.code};
  }
  const actual = createHash('sha256')
    .update(bytes)
    .digest('hex')
    .slice(0, row.sha.length);
  return {state: actual === row.sha ? 'OK' : 'DRIFT', actual};
}

function detailFor(row, result) {
  if (result.state === 'DRIFT') {
    return `recorded ${row.sha}, actual ${result.actual}`;
  }
  if (result.state === 'UNREADABLE') return `read failed: ${result.detail}`;
  return 'file not present in this checkout';
}

// A note names the rule it overrides by key. Report every citation that no
// longer resolves — the rule was reworded, so the note is describing something
// that is not there any more.
function reportKeys() {
  const entries = loadCorpus(derivePrefixes(loadCanonicalIds()));
  const dangling = danglingKeys(entries);
  for (const {note, cited} of dangling) {
    process.stdout.write(
      `STALE KEY\t${note}\tcites ${cited}, which no entry carries\n`,
    );
  }
  const cited = entries
    .filter(entry => entry.origin === 'note')
    .reduce((total, note) => total + note.overrides.length, 0);
  process.stdout.write(
    `\n${cited} note citation(s) resolve, ${dangling.length} do not.\n`,
  );
  if (dangling.length > 0) {
    process.stdout.write(
      'A stale key means the harvested rule was reworded or re-harvested. ' +
        'Re-read the rule, then update the note to the key it prints now.\n',
    );
  }
}

function main() {
  const rows = parseSources(readFileSync(sourcesPath, 'utf8'));
  const counts = {OK: 0, DRIFT: 0, 'NOT VERIFIABLE': 0, UNREADABLE: 0};

  for (const row of rows) {
    const result = stateOf(row);
    counts[result.state] += 1;
    if (result.state === 'OK') continue;
    process.stdout.write(
      `${result.state}\t${row.path}\t${detailFor(row, result)}\n`,
    );
  }

  process.stdout.write(
    `\n${rows.length} harvested sources: ${counts.OK} OK, ` +
      `${counts.DRIFT} DRIFT, ${counts['NOT VERIFIABLE']} NOT VERIFIABLE, ` +
      `${counts.UNREADABLE} UNREADABLE.\n`,
  );
  if (counts.DRIFT > 0) {
    process.stdout.write(
      'A drifted source means the harvested entries derived from it describe an ' +
        'older revision. Re-harvest that source, or record what changed as a ' +
        'note under docs/knowledge/notes/. This check never fails the build.\n',
    );
  }
  if (counts['NOT VERIFIABLE'] > 0) {
    process.stdout.write(
      'NOT VERIFIABLE is expected off the harvest machine: the styleguide root ' +
        'is a sibling repository at an absolute path. It is not a failure.\n',
    );
  }
  reportKeys();
  return 0;
}

export {parseSources, stateOf, detailFor};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    const messages = [];
    for (let current = error; current; current = current.cause) {
      messages.push(current.message);
    }
    process.stderr.write(`${messages.join('\n  caused by: ')}\n`);
    process.exitCode = 2;
  }
}
