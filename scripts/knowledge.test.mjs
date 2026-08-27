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
  derivePrefixes,
  extractIds,
  loadCanonicalIds,
  loadCorpus,
  matches,
  parseFile,
  parseSub,
  renderCoverage,
  renderEntries,
  renderListTopics,
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
  assert.equal(entries.length, 1470);
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

test('--list-topics covers every topic file and counts the ID-less ones', () => {
  const entries = loadCorpus(prefixes);
  const report = renderListTopics(entries);

  assert.equal(topicFiles().length, 39);
  for (const name of topicFiles()) {
    assert.ok(
      report.includes(name.replace(/\.md$/, '')),
      `${name} missing from --list-topics`,
    );
  }
  assert.match(report, /39 topic files\. 16 carry no requirement ID at all/);
});
