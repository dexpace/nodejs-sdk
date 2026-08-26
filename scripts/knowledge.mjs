// scripts/knowledge.mjs
//
// Query surface over `docs/knowledge/`. The corpus is 39 topic files and ~1470
// harvested entries; without a filter, answering "what do we already know about
// RETRY-12" means reading a 20 KB file. This turns that into a query that
// returns the handful of entries that actually cite the requirement.
//
// Not a gate. Nothing in `.github/workflows/` runs this — `--coverage` is a
// report you run by hand when annotating the corpus, not a blocking check.
//
// Zero dependencies, plain Node ESM, same shape as the `verify-*.mjs` scripts.
import {readFileSync, readdirSync} from 'node:fs';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const knowledgeDir = join(repoRoot, 'docs', 'knowledge');
const appendixCPath = join(
  repoRoot,
  'docs',
  'product-spec',
  'appendix-c-consolidated-normative-requirement-index.md',
);

// `INDEX.md` is a generated topic table and `SOURCES.md` a provenance manifest;
// neither holds entries, and both would parse as noise.
const NON_TOPIC_FILES = new Set(['INDEX.md', 'SOURCES.md']);

// Appendix B is the conformance-test checklist. Its entries roll several
// requirement IDs into one "the suite verifies X, Y, Z" sentence, so they make
// an ID look cited while carrying none of its content. 256 of the 641 cited IDs
// resolve ONLY to a roll-up — a silent wrong answer unless it is called out.
const ROLLUP_SOURCE = 'appendix-b-conformance-test-checklist';

// Provenance roles the corpus uses, most common first.
const ROLES = ['spec', 'design', 'styleguide', 'review'];

// The six sections every harvested topic file carries, in emission order.
const SECTIONS = [
  'Rules',
  'Constraints',
  'Conclusions',
  'Reference',
  'Conflicts',
  'Superseded',
];

// ---------------------------------------------------------------------------
// Canonical requirement IDs
// ---------------------------------------------------------------------------

// A bare `\b[A-Z]{2,12}-\d+\b` is not a requirement-ID matcher: it also claims
// `UTF-8` (10 hits in the corpus), `SHA-256`, `ISO-8601` and `RFC-3986`. The
// only authority on what a requirement ID looks like is appendix C, so the
// prefix allowlist is derived from it at runtime and never hardcoded — a spec
// revision that adds a subsystem is picked up without editing this file.
const ID_TOKEN = /\b[A-Z][A-Z0-9]{1,11}-\d+\b/g;
const APPENDIX_C_ROW = /^\|\s*([A-Z][A-Z0-9]{1,11}-\d+)\s*\|/;

function loadCanonicalIds() {
  let text;
  try {
    text = readFileSync(appendixCPath, 'utf8');
  } catch (cause) {
    throw new Error(
      `cannot read the canonical requirement index at ${appendixCPath}; ` +
        'the requirement-ID allowlist is derived from it and there is no fallback',
      {cause},
    );
  }

  const ids = new Map();
  for (const line of text.split('\n')) {
    const match = APPENDIX_C_ROW.exec(line);
    if (!match) continue;
    const cells = line.split('|').map(cell => cell.trim());
    // `| ID | Level | Subsystem | Requirement |` — leading/trailing empties.
    ids.set(match[1], {
      id: match[1],
      level: cells[2] ?? '',
      subsystem: cells[3] ?? '',
    });
  }

  if (ids.size === 0) {
    throw new Error(
      `parsed zero requirement IDs out of ${appendixCPath}; its table format ` +
        'changed and the allowlist cannot be derived — refusing to fall back ' +
        'to a bare regex, which false-positives on UTF-8 and SHA-256',
    );
  }
  return ids;
}

function derivePrefixes(canonicalIds) {
  const prefixes = new Set();
  for (const id of canonicalIds.keys()) {
    prefixes.add(id.slice(0, id.lastIndexOf('-')));
  }
  return prefixes;
}

// Tokenize, then compare whole tokens. Never substring-match: `HTTP-7` and
// `HTTP-70` are different requirements and a substring test conflates them.
function extractIds(text, prefixes) {
  const found = [];
  for (const [token] of text.matchAll(ID_TOKEN)) {
    if (!prefixes.has(token.slice(0, token.lastIndexOf('-')))) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Corpus parsing
// ---------------------------------------------------------------------------

const SECTION_HEADING = /^##\s+(.+?)\s*$/;
const BULLET_START = /^-\s+(.*)$/;
const SUB_LINE = /^\s+<sub>(.*)<\/sub>\s*$/;
const ROLE_AND_SOURCE = /^(\S+)\s+`(.+)`$/;
const BARE_SOURCE = /^`(.+)`$/;

// Two `<sub>` shapes are in the corpus:
//   role · `path:lines` · confidence · sha:xxxx        (the common one)
//   roleA `pathA` · roleB `pathB` · resolution-status  (Conflicts entries)
// so role and path are sometimes separate ` · ` fields and sometimes one. Walk
// the fields and classify each rather than reading them positionally.
function parseSub(inner) {
  const roles = [];
  const sources = [];
  let confidence = null;
  let sha = null;
  let pendingRole = null;

  for (const raw of inner.split(' · ')) {
    const field = raw.trim();

    const pair = ROLE_AND_SOURCE.exec(field);
    if (pair) {
      roles.push(pair[1]);
      sources.push(pair[2]);
      pendingRole = null;
      continue;
    }

    const bare = BARE_SOURCE.exec(field);
    if (bare) {
      roles.push(pendingRole ?? 'unknown');
      sources.push(bare[1]);
      pendingRole = null;
      continue;
    }

    if (field.startsWith('sha:')) {
      sha = field.slice('sha:'.length);
      continue;
    }

    // A lone word that is not a confidence level is the role of the source
    // field that follows it; anything else is the confidence / status.
    if (pendingRole !== null) confidence = pendingRole;
    pendingRole = /^\S+$/.test(field) ? field : null;
    if (pendingRole === null) confidence = field;
  }
  if (pendingRole !== null) confidence = pendingRole;

  return {
    role: roles[0] ?? null,
    roles,
    source: sources[0] ?? null,
    sources,
    confidence,
    sha,
  };
}

function parseFile(path, prefixes) {
  const entries = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const file = basename(path);
  let section = null;
  let current = null;

  const flush = () => {
    if (!current) return;
    current.reqs = extractIds(current.text, prefixes);
    entries.push(current);
    current = null;
  };

  for (const [index, line] of lines.entries()) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      flush();
      section = heading[1];
      continue;
    }

    const sub = SUB_LINE.exec(line);
    if (sub && current) {
      Object.assign(current, parseSub(sub[1]), {subLine: line.trim()});
      continue;
    }

    const bullet = BULLET_START.exec(line);
    if (bullet) {
      flush();
      current = {
        file,
        line: index + 1,
        section,
        text: bullet[1],
        role: null,
        roles: [],
        source: null,
        sources: [],
        confidence: null,
        sha: null,
        subLine: null,
      };
      continue;
    }

    // A continuation line: any non-`<sub>` line before the open bullet's
    // provenance line, blank lines included — a few Conflicts entries run to
    // several paragraphs, and dropping the tail silently loses the requirement
    // IDs it cites. An entry therefore ends only at its `<sub>`, at the next
    // bullet, at the next heading, or at end of file.
    if (current && !current.subLine && line.trim() !== '') {
      current.text += ` ${line.trim()}`;
    }
  }

  flush();
  return entries;
}

function loadCorpus(prefixes) {
  return topicFiles().flatMap(name =>
    parseFile(join(knowledgeDir, name), prefixes),
  );
}

function topicFiles() {
  return readdirSync(knowledgeDir)
    .filter(name => name.endsWith('.md') && !NON_TOPIC_FILES.has(name))
    .sort();
}

// True when every source this entry cites is the conformance checklist, i.e.
// the entry names requirement IDs without saying anything about them.
function isRollup(entry) {
  return (
    entry.sources.length > 0 &&
    entry.sources.every(source => source.includes(ROLLUP_SOURCE))
  );
}

// Styleguide `<sub>` paths carry a numbered chapter file
// (`.../typescript/06-classes-and-data-modeling.md:168-183`), so "styleguide
// 6.7" is answerable by matching the chapter number — no hardcoded chapter →
// topic table that could drift from the styleguide itself.
// Only styleguide-role sources count: `docs/product-spec/04-…md` is a numbered
// chapter too, and conflating the two would answer "styleguide 4" with spec
// chapter 4. `roles[i]` pairs with `sources[i]`.
const STYLEGUIDE_CHAPTER = /\/(\d{2})-[^/]*\.md(?::|$)/;

function chaptersOf(entry) {
  const chapters = [];
  entry.sources.forEach((source, index) => {
    if (entry.roles[index] !== 'styleguide') return;
    const match = STYLEGUIDE_CHAPTER.exec(source);
    if (match) chapters.push(String(Number(match[1])));
  });
  return chapters;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function buildFilters(options, positionals, canonicalIds) {
  const reqs = (options.req ?? []).flatMap(value => value.split(','));
  for (const id of reqs) {
    if (!canonicalIds.has(id)) {
      process.stderr.write(
        `warning: ${id} is not in appendix C — it is not a canonical ` +
          'requirement ID, so no entry can legitimately cite it\n',
      );
    }
  }

  const topics = (options.topic ?? []).flatMap(value => value.split(','));

  const roles = (options.role ?? [])
    .flatMap(value => value.split(','))
    .map(value => {
      if (!ROLES.includes(value)) {
        throw new Error(
          `unknown role '${value}'; the roles are ${ROLES.join(', ')}`,
        );
      }
      return value;
    });

  // "styleguide 6.7" — the chapter is queryable, the sub-section number is not,
  // so take the chapter and say plainly that the rest was dropped.
  const chapters = (options.chapter ?? [])
    .flatMap(value => value.split(','))
    .map(value => {
      const match = /^(\d{1,2})(?:\.(\d+))?$/.exec(value.trim());
      if (!match) {
        throw new Error(
          `unknown chapter '${value}'; expected a styleguide chapter like 6 or 6.7`,
        );
      }
      if (match[2] !== undefined) {
        process.stderr.write(
          'note: entries record a chapter file and line range, not section ' +
            `numbers — querying chapter ${match[1]}, ignoring .${match[2]}. ` +
            'Narrow with bare words.\n',
        );
      }
      return String(Number(match[1]));
    });

  const sections = (options.section ?? [])
    .flatMap(value => value.split(','))
    .map(value => {
      const resolved = SECTIONS.find(
        name => name.toLowerCase() === value.toLowerCase(),
      );
      if (!resolved) {
        throw new Error(
          `unknown section '${value}'; the six sections are ${SECTIONS.join(', ')}`,
        );
      }
      return resolved;
    });

  const patterns = [];
  for (const source of options.grep ?? []) {
    patterns.push(new RegExp(source, 'i'));
  }
  for (const word of positionals) {
    patterns.push(new RegExp(escapeRegExp(word), 'i'));
  }

  return {reqs, topics, roles, chapters, sections, patterns};
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every supplied filter must hold — they AND, never OR. Within one filter,
// multiple values OR (`--req A --req B` is "cites A or B").
function matches(entry, filters) {
  const {reqs, topics, roles, chapters, sections, patterns} = filters;
  if (reqs.length > 0 && !reqs.some(id => entry.reqs.includes(id)))
    return false;
  if (topics.length > 0 && !topics.some(t => entry.file.includes(t))) {
    return false;
  }
  if (sections.length > 0 && !sections.includes(entry.section)) return false;
  if (roles.length > 0 && !roles.some(r => entry.roles.includes(r))) {
    return false;
  }
  if (chapters.length > 0) {
    const entryChapters = chaptersOf(entry);
    if (!chapters.some(c => entryChapters.includes(c))) return false;
  }
  if (!patterns.every(pattern => pattern.test(entry.text))) return false;
  return true;
}

function isEmptyFilter(filters) {
  return (
    filters.reqs.length === 0 &&
    filters.topics.length === 0 &&
    filters.roles.length === 0 &&
    filters.chapters.length === 0 &&
    filters.sections.length === 0 &&
    filters.patterns.length === 0
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function citationIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const id of entry.reqs) {
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(entry);
    }
  }
  return index;
}

function compareIds(a, b) {
  const [prefixA, numberA] = splitId(a);
  const [prefixB, numberB] = splitId(b);
  return prefixA === prefixB
    ? numberA - numberB
    : prefixA.localeCompare(prefixB);
}

function splitId(id) {
  const cut = id.lastIndexOf('-');
  return [id.slice(0, cut), Number(id.slice(cut + 1))];
}

function renderListReqs(index) {
  const out = [];
  for (const id of [...index.keys()].sort(compareIds)) {
    const locations = index
      .get(id)
      .map(entry => `${entry.file}:${entry.line}`)
      .join(' ');
    out.push(`${id}\t${locations}`);
  }
  out.push('');
  out.push(`${index.size} requirement IDs cited across the corpus`);
  return out.join('\n');
}

function renderListTopics(entries) {
  const stats = new Map();
  for (const entry of entries) {
    const name = entry.file.replace(/\.md$/, '');
    if (!stats.has(name)) stats.set(name, {entries: 0, ids: new Set()});
    stats.get(name).entries += 1;
    entry.reqs.forEach(id => stats.get(name).ids.add(id));
  }
  const out = ['topic\tentries\tdistinct IDs'];
  for (const [name, {entries: count, ids}] of [...stats].sort()) {
    out.push(`${name}\t${count}\t${ids.size}`);
  }
  const idless = [...stats].filter(([, v]) => v.ids.size === 0).length;
  out.push('');
  out.push(
    `${stats.size} topic files. ${idless} carry no requirement ID at all — ` +
      'those are styleguide-derived and are only reachable topic-first.',
  );
  return out.join('\n');
}

function renderCoverage(canonicalIds, index) {
  const uncovered = [...canonicalIds.keys()]
    .filter(id => !index.has(id))
    .sort(compareIds);

  const byPrefix = new Map();
  let rollupOnlyTotal = 0;
  for (const id of canonicalIds.keys()) {
    const [prefix] = splitId(id);
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, {total: 0, missing: [], rollupOnly: []});
    }
    const row = byPrefix.get(prefix);
    row.total += 1;
    const hits = index.get(id);
    if (!hits) {
      row.missing.push(id);
    } else if (hits.every(isRollup)) {
      // Cited, but only by a conformance-checklist sentence that names it.
      row.rollupOnly.push(id);
      rollupOnlyTotal += 1;
    }
  }

  const out = ['requirement-ID coverage of docs/knowledge/', ''];
  out.push('prefix\tsubstantive\troll-up only\tuncited\ttotal\tuncited IDs');
  for (const prefix of [...byPrefix.keys()].sort()) {
    const {total, missing, rollupOnly} = byPrefix.get(prefix);
    const substantive = total - missing.length - rollupOnly.length;
    out.push(
      `${prefix}\t${substantive}\t${rollupOnly.length}\t${missing.length}\t` +
        `${total}\t${missing.length === 0 ? '-' : missing.join(' ')}`,
    );
  }
  const substantiveTotal =
    canonicalIds.size - uncovered.length - rollupOnlyTotal;
  out.push('');
  out.push(
    `${substantiveTotal}/${canonicalIds.size} canonical IDs have a substantive ` +
      `entry. ${rollupOnlyTotal} more are named only by an appendix-B ` +
      `conformance roll-up (cited, but no content). ${uncovered.length} are ` +
      'cited nowhere.',
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function renderEntries(results, brief, filters) {
  const out = [];
  for (const entry of results) {
    const tag = isRollup(entry) ? ' [appendix-B roll-up]' : '';
    out.push(`${entry.file}:${entry.line} (${entry.section})${tag}`);
    out.push(`- ${entry.text}`);
    if (!brief && entry.subLine) out.push(`  ${entry.subLine}`);
    out.push('');
  }
  const files = new Set(results.map(entry => entry.file));
  out.push(`${results.length} entries across ${files.size} topic files`);

  // The silent wrong answer this tool can give: a `--req` that "hits" but whose
  // every hit merely names the ID in a conformance-checklist sentence. Exit 0
  // makes it look answered, so say so loudly instead.
  if (results.every(isRollup) && (filters?.reqs.length ?? 0) > 0) {
    out.push(
      '',
      'WARNING: every result is an appendix-B conformance roll-up — it names ' +
        `${filters.reqs.join(', ')} without stating the requirement. The corpus ` +
        'has no substantive entry. Read the canonical text in appendix C and ' +
        'the owning docs/product-spec/NN chapter instead.',
    );
  }
  return out.join('\n');
}

// A zero-result query must never look like "the corpus has nothing to say" when
// it is really a typo or the wrong topic name, so spend the tokens on saying
// what nearby things do exist.
function renderNoMatches(filters, entries, index, canonicalIds) {
  const out = ['no matching entries.'];

  for (const id of filters.reqs) {
    const [prefix, number] = splitId(id);
    if (!canonicalIds.has(id)) {
      out.push(
        `  ${id} is not a canonical requirement ID (not in appendix C).`,
      );
    } else {
      out.push(`  ${id} is canonical but no entry cites it yet.`);
    }
    const nearest = [...index.keys()]
      .filter(other => splitId(other)[0] === prefix)
      .sort((a, b) => {
        const distance =
          Math.abs(splitId(a)[1] - number) - Math.abs(splitId(b)[1] - number);
        return distance === 0 ? compareIds(a, b) : distance;
      })
      .slice(0, 5);
    if (nearest.length > 0) {
      out.push(`  nearest cited ${prefix} IDs: ${nearest.join(' ')}`);
    } else {
      const prefixes = [
        ...new Set([...index.keys()].map(id2 => splitId(id2)[0])),
      ];
      out.push(
        `  no ${prefix} ID is cited anywhere. cited prefixes: ${prefixes.sort().join(' ')}`,
      );
    }
    const topics = topicsForPrefix(entries, prefix);
    if (topics.length > 0) {
      out.push(`  topics carrying ${prefix} knowledge: ${topics.join(' ')}`);
    }
  }

  for (const topic of filters.topics) {
    const known = [...new Set(entries.map(entry => entry.file))];
    if (!known.some(file => file.includes(topic))) {
      out.push(
        `  no topic file matches '${topic}'. available: ` +
          known.map(file => file.replace(/\.md$/, '')).join(' '),
      );
    }
  }

  for (const section of filters.sections) {
    if (!entries.some(entry => entry.section === section)) {
      out.push(
        `  the ${section} section is empty across all 39 topic files — ` +
          'nothing has been harvested into it.',
      );
    }
  }

  for (const chapter of filters.chapters) {
    const known = [
      ...new Set(entries.flatMap(entry => chaptersOf(entry))),
    ].sort((a, b) => Number(a) - Number(b));
    if (!known.includes(chapter)) {
      out.push(
        `  no entry cites styleguide chapter ${chapter}. harvested ` +
          `chapters: ${known.join(' ')}`,
      );
    }
  }

  if (filters.patterns.length > 0 && filters.reqs.length === 0) {
    out.push(
      '  text filters are applied to entry text only; try --grep with a ' +
        'looser pattern, or drop --section/--topic.',
    );
  }
  return out.join('\n');
}

function topicsForPrefix(entries, prefix) {
  const counts = new Map();
  for (const entry of entries) {
    for (const id of entry.reqs) {
      if (splitId(id)[0] !== prefix) continue;
      counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([file]) => file.replace(/\.md$/, ''));
}

const USAGE = `Usage: bun run knowledge [options] [words...]

Query docs/knowledge/. Different filters AND together; values within one filter OR.

  --req <ID>          entries citing that requirement ID (repeatable, comma-ok).
                      Comma form is the whole-task query: --req HTTP-13,HTTP-14
  --topic <names>     topic files whose name contains any of these (substring)
  --section <names>   ${SECTIONS.map(s => s.toLowerCase()).join(' | ')}
  --role <names>      ${ROLES.join(' | ')}
  --chapter <n>       styleguide chapter, e.g. 6 (a "6.7" drops the .7)
  --grep <regex>      case-insensitive regex over entry text (repeatable)
  <words...>          bare words: case-insensitive substrings, all must match
  --brief             drop <sub> provenance lines (~30% less output)
  --json              machine-readable records
  --list-topics       the 39 topics with entry and distinct-ID counts
  --list-reqs         requirement-ID -> location map (~6k tokens; prefer --coverage)
  --coverage          substantive vs roll-up-only vs uncited, per prefix
  --help

Exits 1 when a query matches nothing.

Examples:
  bun run knowledge --req HTTP-13,HTTP-14,HTTP-15   # one task's whole ID set
  bun run knowledge --chapter 6 interface class     # "styleguide 6.7"
  bun run knowledge --section conflicts --brief     # open design-vs-styleguide calls
  bun run knowledge --topic pipeline --section rules --brief cursor fork
`;

function main(argv) {
  const {values, positionals} = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      req: {type: 'string', multiple: true},
      topic: {type: 'string', multiple: true},
      section: {type: 'string', multiple: true},
      role: {type: 'string', multiple: true},
      chapter: {type: 'string', multiple: true},
      grep: {type: 'string', multiple: true},
      brief: {type: 'boolean', default: false},
      json: {type: 'boolean', default: false},
      'list-topics': {type: 'boolean', default: false},
      'list-reqs': {type: 'boolean', default: false},
      coverage: {type: 'boolean', default: false},
      help: {type: 'boolean', default: false},
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const canonicalIds = loadCanonicalIds();
  const entries = loadCorpus(derivePrefixes(canonicalIds));
  const index = citationIndex(entries);

  if (values['list-topics']) {
    process.stdout.write(`${renderListTopics(entries)}\n`);
    return 0;
  }
  if (values['list-reqs']) {
    process.stdout.write(`${renderListReqs(index)}\n`);
    return 0;
  }
  if (values.coverage) {
    process.stdout.write(`${renderCoverage(canonicalIds, index)}\n`);
    return 0;
  }

  const filters = buildFilters(values, positionals, canonicalIds);
  if (isEmptyFilter(filters)) {
    process.stdout.write(USAGE);
    return 0;
  }

  const results = entries.filter(entry => matches(entry, filters));

  if (values.json) {
    const annotated = results.map(entry => ({
      ...entry,
      rollup: isRollup(entry),
    }));
    process.stdout.write(`${JSON.stringify(annotated, null, 2)}\n`);
    return results.length === 0 ? 1 : 0;
  }

  if (results.length === 0) {
    process.stdout.write(
      `${renderNoMatches(filters, entries, index, canonicalIds)}\n`,
    );
    return 1;
  }

  process.stdout.write(`${renderEntries(results, values.brief, filters)}\n`);
  return 0;
}

export {
  loadCanonicalIds,
  derivePrefixes,
  extractIds,
  parseSub,
  parseFile,
  loadCorpus,
  citationIndex,
  buildFilters,
  matches,
  renderCoverage,
  renderEntries,
  renderListTopics,
  isRollup,
  chaptersOf,
  topicFiles,
  compareIds,
  main,
};

// Only run the CLI when invoked directly, so the test file can import the
// parsing helpers without the process exiting underneath it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
