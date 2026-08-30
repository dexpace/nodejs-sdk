// SPDX-License-Identifier: MIT
// scripts/knowledge.test.mjs
//
// Run with `bun run test:scripts` (`node --test 'scripts/*.test.mjs'` — Node
// 26 no longer accepts a bare directory there). Deliberately outside `bun test`,
// which `bunfig.toml` scopes to `packages`: the 80% line-coverage floor is a
// statement about `packages/core`, not about repo tooling.
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import {
  buildFilters,
  citationIndex,
  compareIds,
  danglingKeys,
  derivePrefixes,
  entryKey,
  entryLocation,
  extractIds,
  loadCanonicalIds,
  loadCorpus,
  matches,
  parseFile,
  parseSub,
  renderCoverage,
  renderEntries,
  renderListTopics,
  renderNoMatches,
  isRollup,
  chaptersOf,
  topicFiles,
} from './knowledge.mjs';

const canonicalIds = loadCanonicalIds();
const prefixes = derivePrefixes(canonicalIds);

function fixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-test-'));
  const path = join(dir, 'topic.md');
  writeFileSync(path, body);
  return path;
}

// --- canonical IDs and the derived allowlist -------------------------------

test('appendix C parses into the full canonical requirement set', () => {
  assert.equal(canonicalIds.size, 645);
  assert.equal(canonicalIds.get('SEAM-1').level, 'MUST');
  assert.equal(canonicalIds.get('RETRY-12').level, 'SHOULD');
  assert.ok(canonicalIds.has('HTTP-7'));
});

test('the prefix allowlist is derived from appendix C, not hardcoded', () => {
  assert.equal(prefixes.size, 19);
  for (const prefix of ['HTTP', 'SEAM', 'RETRY', 'CTX', 'NFR']) {
    assert.ok(prefixes.has(prefix), `${prefix} should be a canonical prefix`);
  }
});

test('the allowlist rejects the shapes a bare regex false-positives on', () => {
  const text =
    'Encode as UTF-8, hash with SHA-256, per RFC-3986 and ISO-8601, see HTTP-7.';
  assert.deepEqual(extractIds(text, prefixes), ['HTTP-7']);
  for (const prefix of ['UTF', 'SHA', 'RFC', 'ISO']) {
    assert.ok(!prefixes.has(prefix), `${prefix} must not be an ID prefix`);
  }
});

test('ID extraction is exact-token, so HTTP-7 does not match HTTP-70', () => {
  const found = extractIds(
    'Covers HTTP-70 and HTTP-700 but not the short one.',
    prefixes,
  );
  assert.deepEqual(found, ['HTTP-70', 'HTTP-700']);
  assert.ok(!found.includes('HTTP-7'));
});

test('ID extraction de-duplicates and preserves first-seen order', () => {
  assert.deepEqual(
    extractIds('SEAM-29 then HTTP-2 then SEAM-29 again.', prefixes),
    ['SEAM-29', 'HTTP-2'],
  );
});

// --- entry parsing ---------------------------------------------------------

test('entries are attributed to the section heading above them', () => {
  const path = fixture(
    [
      '# topic',
      '',
      '## Rules',
      '- First rule (HTTP-1).',
      '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc123</sub>',
      '',
      '## Constraints',
      '- A constraint (SEAM-1).',
      '  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:3` · high · sha:def456</sub>',
      '',
    ].join('\n'),
  );
  const entries = parseFile(path, prefixes);

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map(entry => [entry.section, entry.line, entry.reqs]),
    [
      ['Rules', 4, ['HTTP-1']],
      ['Constraints', 8, ['SEAM-1']],
    ],
  );
  assert.equal(entries[0].role, 'spec');
  assert.equal(
    entries[0].source,
    'docs/product-spec/04-core-http-domain-model.md:9',
  );
  assert.equal(entries[0].confidence, 'high');
  assert.equal(entries[0].sha, 'abc123');
});

test('a multi-paragraph bullet keeps its tail, blank lines included', () => {
  const path = fixture(
    [
      '## Conflicts',
      '- Opening claim.',
      '',
      '  Continuation paragraph citing PAGE-11 after a blank line.',
      '  <sub>review · `docs/superpowers/specs/x.md` · high · sha:manual</sub>',
      '',
    ].join('\n'),
  );
  const [entry] = parseFile(path, prefixes);

  assert.match(entry.text, /Continuation paragraph/);
  assert.deepEqual(entry.reqs, ['PAGE-11']);
  assert.equal(entry.section, 'Conflicts');
});

test('a two-source Conflicts <sub> yields both role/source pairs', () => {
  const parsed = parseSub(
    'design `docs/sdk-design-nodejs/04.md:7-14` · styleguide `/abs/06-classes.md:168-183` · unresolved 2026-07-25',
  );
  assert.deepEqual(parsed.roles, ['design', 'styleguide']);
  assert.deepEqual(parsed.sources, [
    'docs/sdk-design-nodejs/04.md:7-14',
    '/abs/06-classes.md:168-183',
  ]);
  assert.equal(parsed.confidence, 'unresolved 2026-07-25');
  assert.equal(parsed.sha, null);
});

test('the standard four-field <sub> splits role from source correctly', () => {
  const parsed = parseSub(
    'spec · `docs/product-spec/09-retry-and-resilience.md:28` · high · sha:9efbe276001e',
  );
  assert.deepEqual(parsed.roles, ['spec']);
  assert.equal(
    parsed.source,
    'docs/product-spec/09-retry-and-resilience.md:28',
  );
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.sha, '9efbe276001e');
});

test('the real corpus parses with one <sub> per bullet and no orphans', () => {
  const entries = loadCorpus(prefixes);
  const harvested = entries.filter(entry => entry.origin === 'harvested');
  assert.equal(harvested.length, 1457);
  assert.ok(entries.length > harvested.length, 'the notes tree is non-empty');
  for (const entry of entries) {
    assert.ok(entry.subLine, `${entry.file}:${entry.line} lost its <sub> line`);
    assert.ok(
      entry.sources.length > 0,
      `${entry.file}:${entry.line} has no source`,
    );
    assert.ok(entry.section, `${entry.file}:${entry.line} has no section`);
  }
});

// --- filtering -------------------------------------------------------------

const sampleEntry = {
  file: 'retry-and-resilience.md',
  line: 8,
  section: 'Rules',
  text: 'The retryable-status classifier MUST be single-sourced (RETRY-1).',
  roles: ['spec'],
  reqs: ['RETRY-1'],
};

function filtersFor(values, positionals = []) {
  return buildFilters(values, positionals, canonicalIds);
}

test('--req matches on the exact token only', () => {
  assert.ok(matches(sampleEntry, filtersFor({req: ['RETRY-1']})));
  assert.ok(!matches(sampleEntry, filtersFor({req: ['RETRY-10']})));
});

test('filters AND together across dimensions', () => {
  const both = filtersFor({req: ['RETRY-1'], section: ['rules']});
  assert.ok(matches(sampleEntry, both));

  const sectionMiss = filtersFor({req: ['RETRY-1'], section: ['reference']});
  assert.ok(!matches(sampleEntry, sectionMiss));

  const roleMiss = filtersFor({req: ['RETRY-1'], role: ['styleguide']});
  assert.ok(!matches(sampleEntry, roleMiss));

  const topicMiss = filtersFor({req: ['RETRY-1'], topic: ['pagination']});
  assert.ok(!matches(sampleEntry, topicMiss));
});

test('multiple values within one filter OR together', () => {
  const either = filtersFor({req: ['RETRY-99', 'RETRY-1']});
  assert.ok(matches(sampleEntry, either));
});

test('bare words AND together and are case-insensitive', () => {
  assert.ok(
    matches(sampleEntry, filtersFor({}, ['CLASSIFIER', 'single-sourced'])),
  );
  assert.ok(!matches(sampleEntry, filtersFor({}, ['classifier', 'redirect'])));
});

test('an unknown --section name fails loudly rather than matching nothing', () => {
  assert.throws(
    () => filtersFor({section: ['rulez']}),
    /unknown section 'rulez'/,
  );
});

// --- reports ---------------------------------------------------------------

test('a cited ID never appears in the uncited column', () => {
  const index = citationIndex(loadCorpus(prefixes));
  const uncited = [...canonicalIds.keys()].filter(id => !index.has(id));
  for (const id of uncited) {
    assert.equal(index.get(id), undefined);
  }
  assert.ok(index.has('RETRY-13'), 'RETRY-13 should be cited after annotation');
});

test('IDs sort by prefix then numerically, not lexically', () => {
  const sorted = ['HTTP-70', 'HTTP-7', 'AUTH-2', 'HTTP-100'].sort(compareIds);
  assert.deepEqual(sorted, ['AUTH-2', 'HTTP-7', 'HTTP-70', 'HTTP-100']);
});

// --- roll-up detection ------------------------------------------------------

test('an entry sourced only from appendix B is a roll-up', () => {
  const rollup = {
    sources: ['docs/product-spec/appendix-b-conformance-test-checklist.md:91'],
  };
  const substantive = {
    sources: ['docs/product-spec/09-retry-and-resilience.md:28'],
  };
  const mixed = {sources: [...rollup.sources, ...substantive.sources]};

  assert.ok(isRollup(rollup));
  assert.ok(!isRollup(substantive));
  assert.ok(!isRollup(mixed), 'one real source is enough to be substantive');
  assert.ok(!isRollup({sources: []}));
});

test('a --req answered only by roll-ups warns instead of exiting quietly', () => {
  const entries = loadCorpus(prefixes);
  const index = citationIndex(entries);
  const hits = index.get('NFR-13');

  assert.ok(hits.every(isRollup), 'NFR-13 is roll-up-only in this corpus');
  const rendered = renderEntries(hits, false, {reqs: ['NFR-13']});
  assert.match(rendered, /\[appendix-B roll-up\]/);
  assert.match(rendered, /WARNING: every result is an appendix-B/);
  assert.match(rendered, /NFR-13/);
});

test('a substantive result carries no roll-up warning', () => {
  const index = citationIndex(loadCorpus(prefixes));
  const rendered = renderEntries(index.get('RETRY-13'), false, {
    reqs: ['RETRY-13'],
  });
  assert.ok(!rendered.includes('WARNING'));
  assert.ok(!rendered.includes('[appendix-B roll-up]'));
});

test('coverage separates substantive from roll-up-only from uncited', () => {
  const index = citationIndex(loadCorpus(prefixes));
  const report = renderCoverage(canonicalIds, index);

  const rows = report
    .split('\n')
    .map(line => /^([A-Z][A-Z0-9]*)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t/.exec(line))
    .filter(Boolean);
  assert.equal(rows.length, prefixes.size);

  let total = 0;
  for (const [, prefix, sub, rollup, uncited, rowTotal] of rows) {
    assert.equal(
      Number(sub) + Number(rollup) + Number(uncited),
      Number(rowTotal),
      `${prefix}: the three buckets must partition the total`,
    );
    total += Number(rowTotal);
  }
  assert.equal(total, canonicalIds.size);
  assert.match(report, /\d+\/645 canonical IDs have a substantive entry/);
});

// --- styleguide chapters ----------------------------------------------------

test('chapters come from styleguide sources only, never spec chapters', () => {
  const specOnly = {
    roles: ['spec'],
    sources: ['docs/product-spec/04-core-http-domain-model.md:22-22'],
  };
  assert.deepEqual(
    chaptersOf(specOnly),
    [],
    'spec chapter 04 is not chapter 4',
  );

  const styleguide = {
    roles: ['styleguide'],
    sources: [
      '/home/u/styleguide/typescript/06-classes-and-data-modeling.md:168-183',
    ],
  };
  assert.deepEqual(chaptersOf(styleguide), ['6'], 'leading zero is stripped');

  const conflict = {
    roles: ['design', 'styleguide'],
    sources: [
      'docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:12',
      '/home/u/styleguide/typescript/11-testing.md:47-48',
    ],
  };
  assert.deepEqual(chaptersOf(conflict), ['11'], 'only the styleguide side');
});

test('--chapter 6 reaches data-modeling, which carries no requirement ID', () => {
  const entries = loadCorpus(prefixes);
  const filters = filtersFor({chapter: ['6.7']});
  assert.deepEqual(
    filters.chapters,
    ['6'],
    'the sub-section number is dropped',
  );

  const hits = entries.filter(entry => matches(entry, filters));
  assert.ok(hits.length > 0);
  assert.ok(hits.some(entry => entry.file === 'data-modeling.md'));
  assert.ok(
    hits.every(
      entry => entry.reqs.length === 0 || entry.roles.includes('styleguide'),
    ),
  );
});

test('an unknown chapter or role fails loudly, like an unknown section', () => {
  assert.throws(() => filtersFor({chapter: ['six']}), /unknown chapter 'six'/);
  assert.throws(() => filtersFor({role: ['spek']}), /unknown role 'spek'/);
});

// --- topic listing ----------------------------------------------------------

test('--list-topics covers every topic file in both trees', () => {
  const entries = loadCorpus(prefixes);
  const report = renderListTopics(entries);

  const files = topicFiles();
  assert.equal(
    files.filter(file => file.origin === 'harvested').length,
    38,
    'the harvested corpus is 38 topic files, the register having been dropped',
  );
  assert.ok(
    files.some(file => file.origin === 'note'),
    'the notes tree is discovered too',
  );
  for (const {topic} of files) {
    assert.ok(report.includes(topic), `${topic} missing from --list-topics`);
  }
  const topics = new Set(files.map(file => file.topic));
  const harvested = new Set(
    files.filter(file => file.origin === 'harvested').map(file => file.topic),
  );
  assert.match(
    report,
    new RegExp(
      `^${topics.size} topics, ${harvested.size} of them harvested\\.`,
      'm',
    ),
    'the topic count is the union of both trees — deliberate-deviations is note-only',
  );
  // The prose count must agree with the table it summarises. This half tests the renderer, and it
  // holds whatever the corpus says. The count is scoped to harvested topics: a note-only topic is
  // not styleguide-derived, so its row (entries 0) is not an ID-less harvested topic.
  const stated = Number(
    /(\d+) harvested topics carry no requirement ID at all/.exec(report)?.[1],
  );
  const zeroIdRows = report
    .split('\n')
    .filter(line => /^\S+\t[1-9]\d*\t0\t\d+$/.test(line)).length;
  assert.equal(
    stated,
    zeroIdRows,
    "--list-topics' summary line disagrees with its own table",
  );

  // Corpus-shape canary, hardcoded on purpose. It fires when a topic that carried no requirement ID
  // gains its first one, which is a real event rather than noise: ID-less topics are reachable only
  // via `--topic`/`--chapter`, so the count is quoted to readers in two documents outside this file.
  // When it fires, confirm the corpus edit was intended, then move this assertion together with
  // CLAUDE.md's "Querying `docs/knowledge/`" section and `.claude/skills/knowledge-lookup/SKILL.md`.
  // Last moved 16 -> 15 by 36c3f96 (PR #59), whose Phase 10 correction to
  // `docs/knowledge/deliberate-deviations.md` cites CFG-1.
  assert.equal(
    stated,
    15,
    'ID-less topic count changed — update CLAUDE.md and knowledge-lookup/SKILL.md with it',
  );
  assert.match(report, /carry a hand-written note/);
});

test('--coverage pins the substantive / roll-up / uncited split the docs quote', () => {
  // Same canary, for the other three numbers in CLAUDE.md's "Querying `docs/knowledge/`" paragraph.
  // Those had drifted by one apiece and nothing noticed, because the only assertion in this file
  // covering that sentence was the topic count above. A count quoted to a reader and re-verified by
  // nothing is how the corpus and its documentation part company.
  const report = renderCoverage(
    canonicalIds,
    citationIndex(loadCorpus(prefixes)),
  );
  const numbers =
    /(\d+)\/(\d+) canonical IDs have a substantive entry\. (\d+) more are named only by an appendix-B conformance roll-up[^.]*\. (\d+) are cited nowhere/.exec(
      report,
    );
  assert.ok(
    numbers,
    `--coverage summary line not found in:\n${report.slice(-400)}`,
  );
  const [, substantive, total, rollup, uncited] = numbers.map(Number);
  assert.equal(
    total,
    canonicalIds.size,
    'appendix C and --coverage disagree on the ID total',
  );
  assert.equal(
    substantive + rollup + uncited,
    total,
    'the three buckets do not account for every canonical ID',
  );
  assert.deepEqual(
    {substantive, rollup, uncited},
    {substantive: 385, rollup: 256, uncited: 4},
    'corpus coverage changed — update CLAUDE.md and knowledge-lookup/SKILL.md with the new numbers',
  );
});

test('a note and its harvested topic share a name but not a tree', () => {
  const files = topicFiles();
  const pagination = files.filter(file => file.topic === 'pagination');
  assert.deepEqual(
    pagination.map(file => file.origin).sort(),
    ['harvested', 'note'],
    'pagination.md exists in both trees',
  );
  assert.ok(pagination.every(file => file.path.endsWith('pagination.md')));
});

test('an entry location names the tree, so the two are never confused', () => {
  const entries = loadCorpus(prefixes);
  const note = entries.find(entry => entry.origin === 'note');
  const harvested = entries.find(entry => entry.origin === 'harvested');
  assert.match(entryLocation(note), /^notes\/[a-z-]+\.md:\d+$/);
  assert.match(entryLocation(harvested), /^[a-z-]+\.md:\d+$/);
});

// --- the two trees ----------------------------------------------------------

test('an entry records which tree it came from', () => {
  const body = [
    '## Superseded',
    '- A hand-written note.',
    '  <sub>review · `docs/superpowers/specs/x.md` · high · sha:manual-note</sub>',
    '',
  ].join('\n');

  const [harvested] = parseFile(fixture(body), prefixes, 'harvested');
  const [note] = parseFile(fixture(body), prefixes, 'note');

  assert.equal(harvested.origin, 'harvested');
  assert.equal(note.origin, 'note');
});

test('--origin selects one tree and rejects an unknown name', () => {
  const harvested = {origin: 'harvested', roles: ['spec'], reqs: []};
  const note = {origin: 'note', roles: ['review'], reqs: []};

  assert.ok(matches(note, filtersFor({origin: ['note']})));
  assert.ok(!matches(harvested, filtersFor({origin: ['note']})));
  assert.ok(matches(harvested, filtersFor({origin: ['harvested']})));
  assert.throws(
    () => filtersFor({origin: ['notes']}),
    /unknown origin 'notes'/,
  );
});

test('the corpus is both trees, and only notes carry the review role', () => {
  const entries = loadCorpus(prefixes);
  const notes = entries.filter(entry => entry.origin === 'note');

  assert.ok(notes.length > 0, 'the notes tree should hold entries');
  assert.ok(
    notes.every(entry => entry.roles.includes('review')),
    'every note is a review-role entry',
  );
  assert.ok(
    entries
      .filter(entry => entry.origin === 'harvested')
      .every(entry => !entry.roles.includes('review')),
    'no harvested entry carries the review role',
  );
});

// --- --prefix ---------------------------------------------------------------

test('--prefix selects a whole requirement family', () => {
  const http = {reqs: ['HTTP-7'], roles: ['spec']};
  const retry = {reqs: ['RETRY-1'], roles: ['spec']};
  const idless = {reqs: [], roles: ['styleguide']};

  assert.ok(matches(http, filtersFor({prefix: ['HTTP']})));
  assert.ok(!matches(retry, filtersFor({prefix: ['HTTP']})));
  assert.ok(!matches(idless, filtersFor({prefix: ['HTTP']})));
  assert.ok(matches(retry, filtersFor({prefix: ['HTTP,RETRY']})));
});

test('--prefix rejects a name appendix C does not define', () => {
  assert.throws(
    () => filtersFor({prefix: ['UTF']}),
    /'UTF' is not a requirement-ID prefix in appendix C/,
  );
});

test('--prefix beats a --req list at reaching a whole family', () => {
  const entries = loadCorpus(prefixes);
  const hits = entries.filter(entry =>
    matches(entry, filtersFor({prefix: ['PAGE']})),
  );
  assert.ok(hits.length > 0);
  assert.ok(
    hits.every(entry => entry.reqs.some(id => id.startsWith('PAGE-'))),
    'every hit cites a PAGE id',
  );
});

// --- the stable entry key ---------------------------------------------------

test('an entry key is <topic>/<8 hex> derived from the entry text alone', () => {
  const [entry] = parseFile(
    fixture(
      [
        '## Rules',
        '- A rule about HTTP-1.',
        '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc123</sub>',
        '',
      ].join('\n'),
    ),
    prefixes,
    'harvested',
  );

  assert.match(entry.key, /^topic\/[0-9a-f]{8}$/);
  assert.equal(entry.key, entryKey('topic', 'A rule about HTTP-1.'));
});

test('an entry key survives a re-order but not a re-wording', () => {
  const rule = '- A rule about HTTP-1.';
  const sub =
    '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc123</sub>';

  const first = parseFile(
    fixture(['## Rules', rule, sub, '- Another rule.', sub, ''].join('\n')),
    prefixes,
    'harvested',
  );
  const moved = parseFile(
    fixture(['## Rules', '- Another rule.', sub, rule, sub, ''].join('\n')),
    prefixes,
    'harvested',
  );

  assert.notEqual(first[0].line, moved[1].line, 'the entry did move');
  assert.equal(first[0].key, moved[1].key, 'the key does not follow the line');
  assert.notEqual(
    first[0].key,
    first[1].key,
    'a different rule, a different key',
  );
  assert.notEqual(
    entryKey('topic', 'A rule about HTTP-1.'),
    entryKey('topic', 'A rule about HTTP-2.'),
  );
});

test('the key ignores trailing whitespace and the topic scopes it', () => {
  assert.equal(entryKey('t', 'A rule.  '), entryKey('t', 'A rule.'));
  assert.notEqual(entryKey('a', 'A rule.'), entryKey('b', 'A rule.'));
});

// --- parser robustness ------------------------------------------------------

test('a CRLF topic file parses, rather than silently yielding nothing', () => {
  const body = [
    '## Rules',
    '- A rule about HTTP-1.',
    '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc123</sub>',
    '',
  ].join('\r\n');
  const entries = parseFile(fixture(body), prefixes, 'harvested');

  assert.equal(entries.length, 1, 'CRLF must not empty the file');
  assert.equal(entries[0].section, 'Rules');
  assert.equal(entries[0].sources.length, 1);
  assert.equal(entries[0].text, 'A rule about HTTP-1.');
});

test('a BOM does not orphan every entry from its section', () => {
  const body =
    '﻿' +
    [
      '## Rules',
      '- A rule.',
      '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc</sub>',
      '',
    ].join('\n');
  const [entry] = parseFile(fixture(body), prefixes, 'harvested');
  assert.equal(entry.section, 'Rules');
});

test('a second <sub> adds its sources instead of hiding the first', () => {
  const [entry] = parseFile(
    fixture(
      [
        '## Rules',
        '- A rule.',
        '  <sub>review · `docs/superpowers/specs/x.md` · high · sha:manual</sub>',
        '  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9` · high · sha:abc</sub>',
        '',
      ].join('\n'),
    ),
    prefixes,
    'harvested',
  );
  assert.deepEqual(entry.roles, ['review', 'spec']);
  assert.equal(entry.sources.length, 2);
});

test('an unreadable topic file names itself in the error', () => {
  assert.throws(
    () => parseFile(join(tmpdir(), 'knowledge-test-nonexistent.md'), prefixes),
    /cannot read the topic file .*knowledge-test-nonexistent\.md/,
  );
});

// --- empty filter values ----------------------------------------------------

test('an empty filter value is rejected, not treated as "match everything"', () => {
  assert.throws(
    () => filtersFor({topic: ['']}),
    /--topic was given only empty/,
  );
  assert.throws(() => filtersFor({}, ['']), /--grep was given only empty/);
  assert.throws(() => filtersFor({req: [',']}), /--req was given only empty/);
});

test('a trailing comma is dropped, not turned into a whole-corpus query', () => {
  const filters = filtersFor({topic: ['pipeline,']});
  assert.deepEqual(filters.topics, ['pipeline']);
});

// --- --key and note overrides ----------------------------------------------

test('--key selects the single entry with that key', () => {
  const entries = loadCorpus(prefixes);
  const target = entries.find(entry => entry.origin === 'harvested');
  const hits = entries.filter(entry =>
    matches(entry, filtersFor({key: [target.key]})),
  );
  assert.deepEqual(
    hits.map(entry => entry.key),
    [target.key],
  );
});

test('--key rejects anything that is not <topic>/<8 hex>', () => {
  assert.throws(() => filtersFor({key: ['pagination']}), /is not an entry key/);
  assert.throws(
    () => filtersFor({key: ['pagination/xyz']}),
    /is not an entry key/,
  );
});

test('a note links to the harvested entry it names, in both directions', () => {
  const entries = loadCorpus(prefixes);
  const note = entries.find(
    entry => entry.origin === 'note' && entry.section === 'Superseded',
  );
  assert.ok(note.overrides.length > 0, 'the note cites at least one key');

  for (const key of note.overrides) {
    const target = entries.find(entry => entry.key === key);
    assert.ok(target, `${key} resolves`);
    assert.ok(
      target.overriddenBy.includes(entryLocation(note)),
      'the harvested entry points back at the note',
    );
  }
});

test('every key a note cites resolves — a dangling one is a stale note', () => {
  assert.deepEqual(danglingKeys(loadCorpus(prefixes)), []);
});

test('danglingKeys reports a citation whose entry has been reworded', () => {
  const note = {
    origin: 'note',
    file: 'pagination.md',
    line: 8,
    text: 'Supersedes `pagination/deadbeef`.',
  };
  assert.deepEqual(danglingKeys([note]), [
    {note: 'notes/pagination.md:8', cited: 'pagination/deadbeef'},
  ]);
});

test('an overridden harvested entry says so in its rendered header', () => {
  const entries = loadCorpus(prefixes);
  const overridden = entries.find(entry => entry.overriddenBy.length > 0);
  const rendered = renderEntries([overridden], true, {reqs: []});
  assert.match(rendered, /\[overridden by notes\//);
});

// --- zero-result diagnosis --------------------------------------------------

test('an empty intersection is reported as one, not blamed on a filter', () => {
  const entries = loadCorpus(prefixes);
  const filters = filtersFor({prefix: ['HTTP'], req: ['PAGE-11']});
  const index = citationIndex(entries);

  assert.equal(entries.filter(entry => matches(entry, filters)).length, 0);
  const rendered = renderNoMatches(filters, entries, index, canonicalIds);
  assert.match(rendered, /every filter matches something on its own/);
  assert.ok(
    !rendered.includes('no entry cites it yet'),
    'PAGE-11 is cited; blaming it would be a false statement',
  );
});

test('a genuinely uncited ID is still named, and never as its own neighbour', () => {
  const entries = loadCorpus(prefixes);
  const filters = filtersFor({req: ['PAGE-9999']});
  const rendered = renderNoMatches(
    filters,
    entries,
    citationIndex(entries),
    canonicalIds,
  );
  assert.match(rendered, /PAGE-9999 is not a canonical requirement ID/);
  assert.match(rendered, /nearest cited PAGE IDs/);
  assert.ok(!/nearest cited PAGE IDs:.*PAGE-9999/.test(rendered));
});

test('a stale key is diagnosed as a reworded rule, not as a typo', () => {
  const entries = loadCorpus(prefixes);
  const filters = filtersFor({key: ['pagination/deadbeef']});
  const rendered = renderNoMatches(
    filters,
    entries,
    citationIndex(entries),
    canonicalIds,
  );
  assert.match(rendered, /no entry carries the key pagination\/deadbeef/);
  assert.match(rendered, /a key digests the entry's text/i);
});
