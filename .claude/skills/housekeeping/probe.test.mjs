// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/probe.test.mjs
//
// Tests the CHECKS, not a copy of their logic, and not the live tree's cleanliness.
//
// The first version of this file asserted only that each check returned no findings
// against the real repository. That passes just as happily over a check whose body has
// become `return;` — proved by mutation: seven of the eight were replaced with `return;`
// and the suite stayed 29/29 green. `scripts/verify-seam-1.test.mjs:6`,
// `verify-knowledge-structure.test.mjs:4` and `verify-test-partition.test.mjs:4` each
// reached the same conclusion earlier in this repository and build fixture trees instead.
// So does this.
//
// Every check therefore has a pair: a fixture that must be clean, and a mutation of it
// that must fire. The live-tree assertions stay at the end, because they are still what
// says the repository is in order today.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHECK_NAMES, parseNumeral, probe, registerCitations} from './probe.mjs';
import {CLEAN_CLAIMS, makeFixture, removeFixture} from './fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

/** Runs `checks` over a fixture built from `spec` and returns its findings. */
function onFixture(spec, checks) {
  const root = makeFixture(spec);
  try {
    return probe(checks, root).findings;
  } finally {
    removeFixture(root);
  }
}

function messages(findings) {
  return findings.map(f => f.message);
}

// --- numerals ---------------------------------------------------------------------------

test('parseNumeral reads digits, words and compounds, and rejects prose', () => {
  assert.equal(parseNumeral('0'), 0);
  assert.equal(parseNumeral('20'), 20);
  assert.equal(parseNumeral('nine'), 9);
  assert.equal(parseNumeral('Eleven'), 11);
  assert.equal(parseNumeral('Twenty'), 20);
  assert.equal(parseNumeral('twenty-four'), 24);
  assert.equal(parseNumeral('ninety-nine'), 99);
  // The words that made the digits-only version protect one sentence in the repository.
  assert.equal(parseNumeral('published'), null);
  assert.equal(parseNumeral('several'), null);
  assert.equal(parseNumeral('twenty-zero'), null);
});

// --- claims -----------------------------------------------------------------------------

test('a clean fixture reports nothing', () => {
  assert.deepEqual(messages(onFixture({}, undefined)), []);
});

test('claims: a count stated as a WORD and wrong is caught', () => {
  // The exact drift SKILL.md names as this tool's reason for existing.
  const found = onFixture(
    {
      overrides: {
        'CLAUDE.md': `# CLAUDE.md\n\n${CLEAN_CLAIMS}\n\nSeven packages, actually.\n\ndocs/README.md docs/open-items.md docs/work docs/sdk-documentation docs/superpowers\n`,
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /states "Seven packages" but the repository has 2/.test(f.message),
    ),
    `expected a word-count finding, got: ${JSON.stringify(messages(found))}`,
  );
});

test('claims: a count stated as a DIGIT and wrong is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'README.md': `# fixture\n\n${CLEAN_CLAIMS.replace('Three named steps', '7 named steps')}\n`,
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /states "7 named steps" but the repository has 3 named CI steps/.test(
        f.message,
      ),
    ),
    JSON.stringify(messages(found)),
  );
});

test('claims: a DELETED count claim is caught — presence is asserted', () => {
  const found = onFixture(
    {
      overrides: {
        'CLAUDE.md': `# CLAUDE.md\n\n${CLEAN_CLAIMS.replace('Three named steps across two jobs.', 'Some steps across two jobs.')}\n\ndocs/README.md docs/open-items.md docs/work docs/sdk-documentation docs/superpowers\n`,
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /CLAUDE\.md states no count of named CI steps \(3\)/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('claims: a quoted historical count is reported speech, not a claim', () => {
  // CLAUDE.md's own documentation-upkeep section quotes the drift it fixed.
  const found = onFixture(
    {
      overrides: {
        'CLAUDE.md': `# CLAUDE.md\n\n${CLEAN_CLAIMS}\n\nIt used to say "two published packages" and that was wrong.\n\ndocs/README.md docs/open-items.md docs/work docs/sdk-documentation docs/superpowers\n`,
      },
    },
    ['claims'],
  );
  assert.deepEqual(messages(found), []);
});

test("claims: a community-health file's counts are checked when it exists", () => {
  // #58 adds CONTRIBUTING.md and SECURITY.md; they make the same class of claim about this
  // repository. Neither must STATE a count — but a count they do state is checked.
  const found = onFixture(
    {
      overrides: {
        'CONTRIBUTING.md':
          '# contributing\n\n`@dexpace/thing` and `@dexpace/secret`. Seven named steps across two jobs.\n',
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /^CONTRIBUTING\.md states "Seven named steps"/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
  assert.ok(
    !found.some(f => /CONTRIBUTING\.md states no count/.test(f.message)),
    'a community-health file must not be REQUIRED to carry a count',
  );
});

test('claims: a community-health file is not required to NAME every package', () => {
  // The roster lives in CLAUDE.md and README.md. CONTRIBUTING.md states the shape once and
  // points at CLAUDE.md for the table; SECURITY.md names only the packages that carry a
  // security surface. Requiring the full list of either reported eighteen findings against
  // two correct files, which is how a checker teaches people to ignore it.
  const found = onFixture(
    {
      overrides: {
        'CONTRIBUTING.md':
          '# contributing\n\nTwo packages, one of them published.\n',
        'SECURITY.md': '# security\n\nReport privately.\n',
      },
    },
    ['claims'],
  );
  assert.ok(
    !found.some(f =>
      /CONTRIBUTING\.md never names|SECURITY\.md never names/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('claims: an absent community-health file fires nothing', () => {
  // Neither exists on this branch. The check must not report on a file that is not there.
  const found = onFixture({}, ['claims']);
  assert.ok(!found.some(f => /CONTRIBUTING\.md|SECURITY\.md/.test(f.message)));
});

test('claims: an unnamed package is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'README.md': `# fixture\n\n${CLEAN_CLAIMS.replace('`@dexpace/thing` and ', '')}\n`,
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f => /README\.md never names @dexpace\/thing/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('claims: a gate list that omits a blocking gate is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'package.json': `${JSON.stringify(
          {
            name: 'fixture',
            private: true,
            scripts: {
              'verify:seam-1': 'true',
              'verify:brand-new': 'true',
              test: 'true',
            },
          },
          null,
          2,
        )}\n`,
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /CLAUDE\.md lists verification gates but not `verify:brand-new`/.test(
        f.message,
      ),
    ),
    JSON.stringify(messages(found)),
  );
});

test('claims: docs/README.md omitting an entry is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/README.md': '# docs\n\nEntries: README.md, open-items.md.\n',
      },
    },
    ['claims'],
  );
  assert.ok(
    found.some(f =>
      /docs\/README\.md does not list docs\/work/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('claims: an UNTRACKED entry in docs/ does not manufacture findings', () => {
  // Derived from `git ls-files`, so an editor swap file cannot fire four `act` findings.
  const found = onFixture(
    {
      untracked: {
        'docs/.notes.md.swp': 'x',
        'docs/validation-prompts/a.md': '# scratch\n',
      },
    },
    ['claims'],
  );
  assert.deepEqual(messages(found), []);
});

// --- inbox ------------------------------------------------------------------------------

test('inbox: an UNTRACKED phase document is caught', () => {
  // The inbox's normal state: `brainstorming` has just written a file and nobody staged it.
  const found = onFixture(
    {
      untracked: {
        'docs/superpowers/specs/2026-09-01-phase11-thing-design.md':
          '# design\n',
      },
    },
    ['inbox'],
  );
  assert.ok(
    found.some(f =>
      /phase11-thing-design\.md is still in the inbox/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('inbox: a tracked phase document is caught too', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/superpowers/plans/2026-09-01-phase11-thing.md': '# plan\n',
      },
    },
    ['inbox'],
  );
  assert.equal(found.length, 1, JSON.stringify(messages(found)));
});

test('inbox: the inbox README is never reported', () => {
  assert.deepEqual(messages(onFixture({}, ['inbox'])), []);
});

// --- root -------------------------------------------------------------------------------

test('root: a stray register at the repository root is caught', () => {
  const found = onFixture(
    {overrides: {'open-items.md': '# a second register\n'}},
    ['root'],
  );
  assert.ok(
    found.some(f =>
      /^open-items\.md sits at the repository root/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('root: the allowed root files are not reported', () => {
  const found = onFixture(
    {
      overrides: {
        'CONTRIBUTING.md': '# contributing\n',
        'SECURITY.md': '# security\n',
      },
    },
    ['root'],
  );
  assert.deepEqual(messages(found), []);
});

// --- readmes ----------------------------------------------------------------------------

test('readmes: a publishable package with no README is caught', () => {
  const found = onFixture({overrides: {'packages/thing/README.md': null}}, [
    'readmes',
  ]);
  assert.ok(
    found.some(f => /packages\/thing\/README\.md is missing/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('readmes: a thin README is a note, not an act', () => {
  const found = onFixture(
    {overrides: {'packages/thing/README.md': '# thing\n'}},
    ['readmes'],
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'note');
  assert.match(found[0].message, /bytes\. The bar is/);
});

test('readmes: core declared as a dependency rather than a peer is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'packages/thing/package.json': `${JSON.stringify(
          {name: '@dexpace/thing', dependencies: {'@dexpace/core': '*'}},
          null,
          2,
        )}\n`,
      },
    },
    ['readmes'],
  );
  assert.ok(
    found.some(f => /declares @dexpace\/core as a dependency/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('readmes: a private package needs no README', () => {
  assert.deepEqual(messages(onFixture({}, ['readmes'])), []);
});

// --- links ------------------------------------------------------------------------------

test('links: a broken link in a nested docs file is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md':
          '# a\n\n[gone](./nowhere.md)\n',
      },
    },
    ['links'],
  );
  assert.ok(
    found.some(f => /architecture\.md links \.\/nowhere\.md/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('links: a broken link at the TOP of docs/ is caught', () => {
  // `docs/**/*.md` alone misses every file here — git's `**/` does not match zero
  // directories — which left the index and all three registers unchecked.
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md':
          '# Open Items\n\n### A1 — x — **WATCH**\n\n[gone](./nowhere.md)\n',
      },
    },
    ['links'],
  );
  assert.ok(
    found.some(f =>
      /^docs\/open-items\.md links \.\/nowhere\.md/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('links: a broken link in a package README is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'packages/thing/README.md': `# thing\n\n[gone](./etc/nope.md)\n${'x '.repeat(500)}`,
      },
    },
    ['links'],
  );
  assert.ok(
    found.some(f =>
      /packages\/thing\/README\.md links \.\/etc\/nope\.md/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('links: a link inside a fenced block is not a link', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md':
          '# a\n\n```js\nconst LINK = /\\[[^\\]]*\\]\\(([^)]+)\\)/g;\n```\n',
      },
    },
    ['links'],
  );
  assert.deepEqual(messages(found), []);
});

test('links: an external or anchor-only link is skipped', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md':
          '# a\n\n[x](https://example.invalid/nope) [y](#section) [z](mailto:a@b.invalid)\n',
      },
    },
    ['links'],
  );
  assert.deepEqual(messages(found), []);
});

// --- registers --------------------------------------------------------------------------

test('registers: an aggregate register in a specification document is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/work/mvp/phase1/2026-01-01-phase1-thing.md':
          '# phase 1\n\n## Deferred Items Log\n\n| Item |\n|---|\n| a |\n',
      },
    },
    ['registers'],
  );
  assert.ok(
    found.some(f => /carries "## Deferred Items Log"/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('registers: a "Moved out on" pointer stub is not a register', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/work/mvp/phase1/2026-01-01-phase1-thing.md':
          '# phase 1\n\n## Deferred Items Log\n\n**Moved out on 2026-08-31.** See docs/deferred-items.md.\n',
      },
    },
    ['registers'],
  );
  assert.deepEqual(messages(found), []);
});

// --- citations --------------------------------------------------------------------------

// Assembled at run time, never written as one literal. The citation check scans
// `.claude/**`, so a contiguous `open-items.md <ID>` in THIS file is a citation the live
// tree sees — and a deliberately-dangling one would make the suite fail on itself.
const REGISTER = 'open-items.md';
const cite = id => `See \`docs/${REGISTER}\` ${id} for the rest.`;

test('citations: a dangling register citation is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('Z9')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md Z9, which has no/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('citations: a resolving citation is not reported', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('A1')}\n`,
      },
    },
    ['citations'],
  );
  assert.deepEqual(messages(found), []);
});

// Sections Q-T hold the relocated reviews' OWN row numbering, so three `F` namespaces coexist and a
// bare `F8` resolves to any of them. The register's Section index states the qualified form;
// these four cases are the mechanism.
const QUALIFIED_REGISTER =
  '# Open Items\n\n### A1 — a real item — **WATCH**\n\nBody.\n\n' +
  '## Section S — a relocated review\n\n' +
  '| # | Sev | Finding |\n|---|---|---|\n| F8 | minor | a row, not a heading |\n\n' +
  '## Section T — another relocated review\n\n' +
  '| # | Sev | Finding |\n|---|---|---|\n| F9 | major | a different row |\n';

const citeQualified = (section, id) =>
  `See \`docs/${REGISTER}\` ${section}.${id} for the rest.`;

test("citations: a qualified citation resolves against that section's table rows", () => {
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md': QUALIFIED_REGISTER,
        'docs/sdk-documentation/architecture.md': `# a\n\n${citeQualified('S', 'F8')}\n`,
      },
    },
    ['citations'],
  );
  assert.deepEqual(messages(found), []);
});

test('citations: a qualifier naming the wrong section is caught', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md': QUALIFIED_REGISTER,
        // F8 is Section S's row, not Section T's. Both sections exist and both carry an `F`
        // namespace, which is exactly the confusion the qualifier is for.
        'docs/sdk-documentation/architecture.md': `# a\n\n${citeQualified('T', 'F8')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md T\.F8, which Section T carries as neither a table row nor a purged row/.test(
        f.message,
      ),
    ),
    JSON.stringify(messages(found)),
  );
});

test('citations: a qualified ID is NOT satisfied by a `### <ID>` heading elsewhere', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md': QUALIFIED_REGISTER,
        // A1 has a heading, but Section S does not carry it as a row, so `S.A1` must not resolve.
        'docs/sdk-documentation/architecture.md': `# a\n\n${citeQualified('S', 'A1')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f => /cites docs\/open-items\.md S\.A1/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

test('citations: a bare ID still resolves against `### <ID>` headings only', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md': QUALIFIED_REGISTER,
        // F8 exists as a Section S ROW. Unqualified, it must not resolve -- the bare namespace is
        // the `###` headings, and this is what makes the qualifier load bearing rather than optional.
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('F8')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md F8, which has no/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

// A resolved item's body was REMOVED from the register and replaced by one row in `## Retired items`.
// On 2026-09-04 that table was deleted and its rows reproduced verbatim into a dated note, so the
// second namespace of resolvable IDs now lives OUTSIDE the register. The ID is still never released,
// so every citation of it must keep resolving — the check reads the note's `## Purged item IDs` table
// as that second source, bare and section-qualified alike.
const PURGE_NOTE = 'docs/work/mvp/2026-09-04-register-retirement-purge.md';

// The register after the purge: one live heading, and a Section T whose rows are all gone.
const PURGED_REGISTER =
  '# Open Items\n\n### A1 — a live item — **WATCH**\n\nBody.\n\n' +
  '## Section T — a relocated review\n\n' +
  'All rows retired.\n';

// The note, with all three of its tables. Only the FIRST is a namespace, and the other two are the
// two ways that can go wrong. `## Purged rows without an item ID` holds rows whose first cell is not
// an ID at all (`D — …`, `L1 — …`); those fall out of the row pattern wherever it is pointed, which is
// what the real note relies on. `## Purged deferral rows` is the one that would actually leak: give it
// a row keyed like an item ID and a whole-file scan reserves it, while the slice does not.
const PURGE_NOTE_TEXT =
  '# Register retirement purge\n\n' +
  'Prose.\n\n---\n\n' +
  '## Purged item IDs\n\n' +
  '| ID | Title | Resolution | Date | Evidence |\n|---|---|---|---|---|\n' +
  '| `K10` | a fixed item | fixed | 2026-09-02 | `src/x.ts` |\n' +
  '| `T.F9` | a retired review row | fixed | 2026-09-02 | `src/y.ts` |\n\n---\n\n' +
  '## Purged rows without an item ID\n\n' +
  '| Row | Subject | Resolution | Date | Evidence |\n|---|---|---|---|---|\n' +
  '| L1 — `OBS-19` | a Section L half | fixed | 2026-09-02 | `src/w.ts` |\n' +
  '| D — a Section D row | — | shipped | 2026-09-02 | `src/z.ts` |\n' +
  '| R — residual: a thing | — | shipped | 2026-09-02 | `src/v.ts` |\n\n---\n\n' +
  '## Purged deferral rows\n\n' +
  '| Row key | Origin phase | Delivered by | Evidence | Date |\n|---|---|---|---|---|\n' +
  '| `Y7` | Phase 0 | Phase 9 | `src/u.ts` | 2026-09-02 |\n';

const PURGED = {
  'docs/open-items.md': PURGED_REGISTER,
  [PURGE_NOTE]: PURGE_NOTE_TEXT,
};

test("citations: a purged ID resolves against the note's `## Purged item IDs` table", () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('K10')}\n`,
      },
    },
    ['citations'],
  );
  assert.deepEqual(messages(found), []);
});

test('citations: a purged Q-T row resolves through its section qualifier', () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        // Section T no longer carries F9 as a table row -- only the note does.
        'docs/sdk-documentation/architecture.md': `# a\n\n${citeQualified('T', 'F9')}\n`,
      },
    },
    ['citations'],
  );
  assert.deepEqual(messages(found), []);
});

test('citations: an ID in neither the headings nor the note still dangles', () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        // K11 is neither a `### <ID>` heading nor a purged row. The note widens the ID set;
        // it must not turn the check into a no-op.
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('K11')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      new RegExp(
        String.raw`cites docs/open-items\.md K11, which has no \`### <ID>\` heading and no ` +
          String.raw`\`## Purged item IDs\` row in ${PURGE_NOTE}`,
      ).test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('citations: the finding names the note, never the deleted `## Retired items` table', () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('K11')}\n${citeQualified('T', 'F8')}\n`,
      },
    },
    ['citations'],
  );
  assert.equal(found.length, 2, JSON.stringify(messages(found)));
  for (const message of messages(found)) {
    assert.ok(message.includes(PURGE_NOTE), message);
    assert.ok(!/Retired items/.test(message), message);
  }
});

test('citations: a row under `## Purged rows without an item ID` is not an ID', () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        // `L1` is the first cell of a row in the SECOND table. It reserves no ID -- the row is keyed
        // by section and title -- so a citation of it must still dangle. Parsing the whole note
        // instead of the one section is what this case forbids.
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('L1')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md L1, which has no/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('citations: only the `## Purged item IDs` section is a namespace', () => {
  const found = onFixture(
    {
      overrides: {
        ...PURGED,
        // `Y7` is the first cell of a row in the note's THIRD table, which is a deferral audit and
        // reserves no open-item ID. Only the one section is sliced, so a citation of it dangles.
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('Y7')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md Y7, which has no/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('citations: the note being absent degrades rather than throws', () => {
  // The default fixture writes no note at all. `ctx.read` is `readFileSync`, so an unguarded read of
  // the missing path is an ENOENT that replaces every finding with a raw stack; the guard is what
  // makes this a normal run with the pre-purge namespace only.
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('A1')}\n${cite('K10')}\n`,
      },
    },
    ['citations'],
  );
  // Spelled through `REGISTER` for the same reason `cite` is: a contiguous `open-items.md K10` in
  // this file is a citation the live tree resolves, and asserting on one would couple this suite to
  // whatever the real note happens to hold.
  assert.deepEqual(messages(found), [
    `docs/sdk-documentation/architecture.md:4 cites docs/${REGISTER} K10, which has no ` +
      `\`### <ID>\` heading and no \`## Purged item IDs\` row in ${PURGE_NOTE}. ` +
      'Item IDs are permanent; a dangling one means the citation, not the register, is wrong.',
  ]);
});

test('citations: a note with no `## Purged item IDs` heading degrades too', () => {
  const found = onFixture(
    {
      overrides: {
        'docs/open-items.md': PURGED_REGISTER,
        [PURGE_NOTE]: '# a note that lost its table\n\nProse only.\n',
        'docs/sdk-documentation/architecture.md': `# a\n\n${cite('K10')}\n`,
      },
    },
    ['citations'],
  );
  assert.ok(
    found.some(f =>
      /cites docs\/open-items\.md K10, which has no/.test(f.message),
    ),
    JSON.stringify(messages(found)),
  );
});

test('registerCitations is the single derivation, and reports where each site is', () => {
  const root = makeFixture({
    overrides: {
      'docs/sdk-documentation/architecture.md': `# a\n\n${cite('A1')}\n`,
    },
  });
  try {
    const {ctx} = probe([], root);
    const {ids, sites} = registerCitations(ctx);
    assert.deepEqual([...ids], ['A1']);
    assert.equal(sites.length, 1);
    assert.deepEqual(sites[0], {
      file: 'docs/sdk-documentation/architecture.md',
      line: 3,
      id: 'A1',
      // `undefined` rather than absent: an unqualified citation still carries the field, so a
      // caller can tell "bare" from "qualified" without re-parsing the text.
      qualifier: undefined,
      cited: 'A1',
      resolves: true,
    });
  } finally {
    removeFixture(root);
  }
});

// --- non-ASCII paths --------------------------------------------------------------------

test('a non-ASCII filename does not take the run down', () => {
  // `git ls-files` C-quotes it by default, and a quoted path fed to readFileSync is an
  // ENOENT that replaces every finding with a raw stack.
  const found = onFixture(
    {
      overrides: {
        'docs/sdk-documentation/café.md': '# café\n\n[gone](./nowhere.md)\n',
      },
    },
    ['links'],
  );
  assert.ok(
    found.some(f => /café\.md links \.\/nowhere\.md/.test(f.message)),
    JSON.stringify(messages(found)),
  );
});

// --- plumbing ---------------------------------------------------------------------------

test('every check name is selectable, and an unknown one is refused', () => {
  const root = makeFixture();
  try {
    for (const name of CHECK_NAMES) {
      assert.doesNotThrow(() => probe([name], root), name);
    }
    assert.throws(() => probe(['nope'], root), /unknown check 'nope'/);
  } finally {
    removeFixture(root);
  }
});

test('CHECK_NAMES is the eight the documentation states', () => {
  assert.deepEqual(
    [...CHECK_NAMES],
    [
      'inbox',
      'root',
      'claims',
      'readmes',
      'links',
      'registers',
      'citations',
      'guard',
    ],
  );
});

// --- the live tree ----------------------------------------------------------------------

function gitStatus() {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('the probe writes nothing', () => {
  const before = gitStatus();
  probe();
  assert.equal(
    gitStatus(),
    before,
    'the working tree changed during a probe run',
  );
});

test('facts are derived from the repository, not from a document', () => {
  const {facts} = probe([]);
  assert.ok(facts.packages.length >= 2, 'found no packages');
  assert.equal(
    facts.packages.length,
    facts.publishable.length + facts.privatePackages.length,
    'every package is publishable or private, never both or neither',
  );
  assert.ok(facts.publishable.every(p => p.name.startsWith('@dexpace/')));
  assert.ok(facts.namedSteps.length > 0, 'parsed no named CI steps');
  assert.ok(facts.jobs.length >= 1, 'parsed no CI jobs');
  assert.ok(
    facts.jobs.every(j => !j.includes(' ')),
    'a parsed job name looks like prose, so the jobs: block regex has drifted',
  );
  assert.ok(facts.scripts.includes('test'), 'parsed no package scripts');
  assert.ok(facts.verifyScripts.every(s => s.startsWith('verify:')));
  assert.ok(facts.docsEntries.includes('README.md'), 'docs/ has no index');
});

test('every finding names a check and a severity the report can group by', () => {
  for (const f of probe().findings) {
    assert.ok(CHECK_NAMES.includes(f.check), `bad check: ${f.check}`);
    assert.ok(
      ['act', 'note'].includes(f.severity),
      `bad severity: ${f.severity}`,
    );
    assert.ok(f.message.length > 20, 'a finding must say what to do');
  }
});

test('the live tree is clean on every check', () => {
  for (const name of CHECK_NAMES) {
    assert.deepEqual(messages(probe([name]).findings), [], name);
  }
});
