// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/probe.mjs
//
// Read-only. Reports drift; never writes. Eight checks, each of which caught something
// real the first time it ran (`docs/open-items.md` Section U).
//
//   node .claude/skills/housekeeping/probe.mjs            # report, exit 0
//   node .claude/skills/housekeeping/probe.mjs --strict   # exit 1 when anything is found
//   node .claude/skills/housekeeping/probe.mjs --only=links,claims
//   node .claude/skills/housekeeping/probe.mjs --root=/path/to/a/fixture/tree
//
// The eight are deliberately independent: a repository fact is derived once, from the
// repository, and every document that states it is checked against that one derivation.
// Nothing here reads a number out of one document and compares it to another.
//
// `--root` exists for `probe.test.mjs`, which builds throwaway fixture trees and asserts
// each check FIRES — the shape `scripts/verify-seam-1.test.mjs:6` and
// `verify-test-partition.test.mjs:4` already use here. A suite that only asserts the live
// tree is clean passes just as happily over a check whose body has become `return;`, and
// seven of these eight were in exactly that state when it was written.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isFrozen} from './guard.mjs';

function resolveRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: here,
    encoding: 'utf8',
  }).trim();
}

/**
 * Everything a check needs, bound to one repository root.
 *
 * The root is a parameter rather than a module constant so a fixture tree can be probed;
 * that is the only reason this indirection exists.
 */
function createContext(root) {
  const findings = [];
  return {
    root,
    findings,
    read: path => readFileSync(join(root, path), 'utf8'),
    exists: path => existsSync(join(root, path)),
    /**
     * Tracked paths matching `globs`.
     *
     * `-c core.quotePath=false` because `git ls-files` C-quotes any path with a non-ASCII
     * byte by default (`"docs/caf\303\251.md"`), and a quoted path fed back to `readFileSync`
     * is an `ENOENT` that takes the whole run down with a raw stack instead of a finding.
     */
    tracked: (...globs) =>
      execFileSync(
        'git',
        ['-c', 'core.quotePath=false', 'ls-files', '--', ...globs],
        {cwd: root, encoding: 'utf8'},
      )
        .trim()
        .split('\n')
        .filter(Boolean),
    /** Tracked paths PLUS untracked, non-ignored ones. */
    present: (...globs) =>
      execFileSync(
        'git',
        [
          '-c',
          'core.quotePath=false',
          'ls-files',
          '--others',
          '--exclude-standard',
          '--cached',
          '--',
          ...globs,
        ],
        {cwd: root, encoding: 'utf8'},
      )
        .trim()
        .split('\n')
        .filter(Boolean),
    finding: (check, severity, message) =>
      findings.push({check, severity, message}),
  };
}

// ---------------------------------------------------------------------------------------
// Spelled-out numerals.
//
// Every count claim in `CLAUDE.md` and `README.md` is written as an English word --
// "eleven packages", "nine committed reports", "Twenty named CI steps". The first version
// of this file matched `(\d+)` only, so it protected exactly one sentence in the whole
// repository, and appending "Two published packages today, and that is the whole
// workspace." to `CLAUDE.md` -- the precise drift SKILL.md names as this tool's reason for
// existing -- still printed `no drift found`.
// ---------------------------------------------------------------------------------------

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** The number `token` denotes, or `null` when it is not a numeral at all. */
export function parseNumeral(token) {
  const word = token.toLowerCase();
  if (/^\d+$/.test(word)) return Number(word);
  const ones = ONES.indexOf(word);
  if (ones !== -1) return ones;
  if (Object.hasOwn(TENS, word)) return TENS[word];
  const compound = /^([a-z]+)-([a-z]+)$/.exec(word);
  if (compound && Object.hasOwn(TENS, compound[1])) {
    const unit = ONES.indexOf(compound[2]);
    if (unit > 0 && unit < 10) return TENS[compound[1]] + unit;
  }
  return null;
}

/** A digit run or a word that might be a numeral; `parseNumeral` decides which. */
const NUMBER = String.raw`(\d+|[A-Za-z]+(?:-[A-Za-z]+)?)`;

function numberedPattern(tail) {
  return new RegExp(`${NUMBER}\\s+${tail}`, 'gi');
}

/**
 * The count claims the two documents make, each anchored on its own subject.
 *
 * `required` is the point. A count that is merely *checked when found* is not checked at
 * all: deleting the sentence passes, and so does rewording it past the pattern. Every row
 * here must appear in each document that lists it.
 */
function countClaims(facts) {
  return [
    {
      id: 'packages',
      label: 'packages in the workspace',
      actual: facts.packages.length,
      pattern: numberedPattern(String.raw`(?:\*\*)?packages\b`),
      required: ['CLAUDE.md', 'README.md'],
    },
    {
      id: 'publishable',
      label: 'publishable packages',
      actual: facts.publishable.length,
      pattern: numberedPattern(
        String.raw`(?:(?:is|are)\s+)?publish(?:ed|able)\b`,
      ),
      required: ['CLAUDE.md', 'README.md'],
    },
    {
      id: 'private',
      label: 'private packages',
      actual: facts.privatePackages.length,
      pattern: numberedPattern(
        String.raw`(?:more\s+)?(?:is|are)\s+(?:\*\*)?\x60?private\b`,
      ),
      required: ['CLAUDE.md', 'README.md'],
    },
    {
      id: 'api-reports',
      label: 'committed API reports',
      actual: facts.apiReports.length,
      pattern: numberedPattern(String.raw`committed\s+(?:API\s+)?reports?\b`),
      required: ['CLAUDE.md'],
    },
    {
      id: 'ci-steps',
      label: 'named CI steps',
      actual: facts.namedSteps.length,
      pattern: numberedPattern(String.raw`named\s+(?:CI\s+)?steps?\b`),
      required: ['CLAUDE.md', 'README.md'],
    },
    {
      id: 'ci-jobs',
      label: 'CI jobs',
      actual: facts.jobs.length,
      pattern: numberedPattern(String.raw`jobs?\b`),
      required: ['CLAUDE.md', 'README.md'],
    },
  ];
}

// ---------------------------------------------------------------------------------------
// The repository facts. Derived once; every check below compares a document to THESE.
// ---------------------------------------------------------------------------------------

function repositoryFacts(ctx) {
  const packages = readdirSync(join(ctx.root, 'packages'))
    .filter(name => ctx.exists(`packages/${name}/package.json`))
    .map(dir => {
      const manifest = JSON.parse(ctx.read(`packages/${dir}/package.json`));
      return {
        dir,
        name: manifest.name,
        private: manifest.private === true,
        hasReadme: ctx.exists(`packages/${dir}/README.md`),
        readmeBytes: ctx.exists(`packages/${dir}/README.md`)
          ? statSync(join(ctx.root, 'packages', dir, 'README.md')).size
          : 0,
        apiReport: ctx.tracked(`packages/${dir}/etc/*.api.md`),
        peersCore: Object.hasOwn(
          manifest.peerDependencies ?? {},
          '@dexpace/core',
        ),
        dependsOnCore: Object.hasOwn(
          manifest.dependencies ?? {},
          '@dexpace/core',
        ),
      };
    });

  const workflow = ctx.read('.github/workflows/ci.yml');
  // A named step is a `- name:` under `steps:`. Counting `run:` would miss the matrix
  // legs and counting `-` would count `uses:` setup steps, which are not gates.
  // Jobs are the 2-space keys inside the `jobs:` block only. Counting every 2-space key
  // in the file also counts `on:`'s `pull_request:`, which is how this first read 3.
  const jobsBlock = workflow.slice(workflow.indexOf('\njobs:\n'));
  const jobs = [...jobsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(
    m => m[1],
  );
  const namedSteps = [...workflow.matchAll(/^ {6}- name: (.+)$/gm)].map(m =>
    m[1].trim(),
  );

  const scripts = Object.keys(
    JSON.parse(ctx.read('package.json')).scripts ?? {},
  );

  // Tracked, so an editor swap file or an untracked scratch directory in `docs/` cannot
  // manufacture an `act` finding against every document that "omits" it.
  const docsEntries = [
    ...new Set(ctx.tracked('docs/*.md', 'docs/**').map(f => f.split('/')[1])),
  ].sort();

  return {
    packages,
    publishable: packages.filter(p => !p.private),
    privatePackages: packages.filter(p => p.private),
    apiReports: ctx.tracked('packages/*/etc/*.api.md'),
    jobs,
    namedSteps,
    scripts,
    verifyScripts: scripts.filter(s => s.startsWith('verify:')),
    docsEntries,
  };
}

// ---------------------------------------------------------------------------------------
// 1. docs/superpowers/ is an inbox. Anything in it is unfiled.
// ---------------------------------------------------------------------------------------

function checkInbox(ctx) {
  // `present`, not `tracked`: the inbox's NORMAL state is a file `brainstorming` has just
  // written and nobody has staged. A tracked-only sweep reports the empty tree the skill
  // exists to notice.
  const stray = ctx
    .present('docs/superpowers/**')
    .filter(f => posix.basename(f) !== 'README.md');
  for (const file of stray) {
    ctx.finding(
      'inbox',
      'act',
      `${file} is still in the inbox. It belongs under docs/work/<delivery>/phaseN/ — ` +
        'see the collection rules in docs/README.md.',
    );
  }
}

// ---------------------------------------------------------------------------------------
// 2. Documents at the repository root that belong under docs/.
// ---------------------------------------------------------------------------------------

const ROOT_MARKDOWN_ALLOWED = new Set([
  'README.md',
  'CLAUDE.md',
  // #58's scope; permitted the moment they exist.
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'LICENSE.md',
]);

function checkRootDocuments(ctx) {
  // `git ls-files -- '*.md'` matches at any depth: a pathspec glob crosses `/`. The root
  // is what this check is about, so filter to files with no directory component.
  for (const file of ctx.tracked('*.md').filter(f => !f.includes('/'))) {
    if (ROOT_MARKDOWN_ALLOWED.has(file)) continue;
    ctx.finding(
      'root',
      'act',
      `${file} sits at the repository root. A register belongs in docs/, a phase record ` +
        'under docs/work/. The root carries README.md, CLAUDE.md and the community-health ' +
        'files only.',
    );
  }
}

// ---------------------------------------------------------------------------------------
// 3+4. Claims in CLAUDE.md, README.md and the community-health files, against the facts.
// ---------------------------------------------------------------------------------------

/**
 * `CONTRIBUTING.md` and `SECURITY.md` make the same class of ungated claim about this
 * repository — the CI step count, the gate list, the package facts. They do not exist on
 * this branch (issue #58 adds them), so each is checked only if present.
 */
const CLAIM_DOCUMENTS = [
  'CLAUDE.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
];

/**
 * The documents that must name every package, for the same reason `required` exists on a
 * count claim: these two carry the workspace table, so a package missing from them is drift.
 *
 * `CONTRIBUTING.md` and `SECURITY.md` are deliberately not here. Neither enumerates the
 * workspace — `CONTRIBUTING.md` states the shape once and points at `CLAUDE.md` for the
 * table, and `SECURITY.md` names only the packages that carry a security surface. Requiring
 * the full list of them would report eighteen findings against two files that are correct,
 * which is how a checker teaches people to ignore it.
 */
const PACKAGE_ROSTER_DOCUMENTS = ['CLAUDE.md', 'README.md'];

/**
 * The prose a document asserts in its own voice.
 *
 * Fenced code is not prose, and a double-quoted span is reported speech: `CLAUDE.md`'s
 * documentation-upkeep section quotes the historical drift it fixed — `"two published
 * packages" against eleven` — which is a description of a past claim, not a present one.
 * Matching inside either turns a document that explains its own history into a document
 * that fails its own check.
 */
function assertedProse(text) {
  return text.replace(/^```[\s\S]*?^```$/gm, '').replace(/"[^"]*"/g, ' ');
}

function checkClaims(ctx, facts) {
  const claims = countClaims(facts);

  for (const doc of CLAIM_DOCUMENTS) {
    if (!ctx.exists(doc)) continue;
    const text = ctx.read(doc);
    const prose = assertedProse(text);

    for (const pkg of PACKAGE_ROSTER_DOCUMENTS.includes(doc)
      ? facts.packages
      : []) {
      if (!text.includes(pkg.name)) {
        ctx.finding(
          'claims',
          pkg.private ? 'note' : 'act',
          `${doc} never names ${pkg.name}${pkg.private ? ' (private)' : ''}. ` +
            `The workspace has ${String(facts.packages.length)} packages: ` +
            `${String(facts.publishable.length)} publishable, ` +
            `${String(facts.privatePackages.length)} private.`,
        );
      }
    }

    for (const claim of claims) {
      // Every document that states a count is checked; only the documents in `required`
      // must state it. `CONTRIBUTING.md` need not carry a package count — but if it does,
      // being wrong is the same defect it is anywhere else.
      const required = claim.required.includes(doc);
      let stated = 0;
      for (const match of prose.matchAll(claim.pattern)) {
        const value = parseNumeral(match[1]);
        if (value === null) continue; // an adjective, not a numeral
        stated++;
        if (value !== claim.actual) {
          ctx.finding(
            'claims',
            'act',
            `${doc} states "${match[0].trim()}" but the repository has ` +
              `${String(claim.actual)} ${claim.label}.`,
          );
        }
      }
      if (stated === 0 && required) {
        ctx.finding(
          'claims',
          'act',
          `${doc} states no count of ${claim.label} (${String(claim.actual)}). ` +
            'A count that is only checked when it happens to be found is not checked: ' +
            'deleting or rewording the sentence passes.',
        );
      }
    }

    // Only enforced on a document that claims to enumerate the gates. README.md delegates
    // to CLAUDE.md and the preflight command by design, so listing them there is optional —
    // but a document that lists SOME must list all, which is exactly how `verify:sse-37`
    // went unmentioned for four phases.
    // Two or more is a list; one is a citation. README.md naming `verify:seam-1` once as
    // an example of the zero-dependency rule is not a claim to enumerate the gates.
    const mentioned = facts.verifyScripts.filter(s => text.includes(s)).length;
    if (doc === 'CLAUDE.md' || mentioned >= 2) {
      for (const script of facts.verifyScripts) {
        if (!text.includes(script)) {
          ctx.finding(
            'claims',
            'act',
            `${doc} lists verification gates but not \`${script}\`, which is blocking in ` +
              '.github/workflows/ci.yml.',
          );
        }
      }
    }

    if (doc === 'CLAUDE.md') {
      for (const entry of facts.docsEntries) {
        if (!text.includes(`docs/${entry}`)) {
          ctx.finding(
            'claims',
            'note',
            `CLAUDE.md's documentation map omits docs/${entry}.`,
          );
        }
      }
    }
  }

  // docs/README.md is the index; every entry in docs/ must appear in it.
  const index = ctx.read('docs/README.md');
  for (const entry of facts.docsEntries) {
    if (!index.includes(entry)) {
      ctx.finding(
        'claims',
        'act',
        `docs/README.md does not list docs/${entry}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// 5. A README on every publishable package. Private ones are exempt.
// ---------------------------------------------------------------------------------------

const README_THIN_BYTES = 800;

function checkPackageReadmes(ctx, facts) {
  for (const pkg of facts.publishable) {
    if (!pkg.hasReadme) {
      ctx.finding(
        'readmes',
        'act',
        `packages/${pkg.dir}/README.md is missing. The harvested styleguide requires one on ` +
          'every publishable package (docs/knowledge/harvested/documentation.md:28).',
      );
      continue;
    }
    if (pkg.readmeBytes < README_THIN_BYTES) {
      ctx.finding(
        'readmes',
        'note',
        `packages/${pkg.dir}/README.md is ${String(pkg.readmeBytes)} bytes. The bar is ` +
          'zero to one working call in about 30 seconds, without reading source ' +
          '(documentation.md:28-30).',
      );
    }
    if (pkg.dependsOnCore) {
      ctx.finding(
        'readmes',
        'act',
        `packages/${pkg.dir} declares @dexpace/core as a dependency. It must be a peer ` +
          '(SEAM-1, the dual-package hazard).',
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// 6. Broken relative links in docs/, CLAUDE.md, README.md and the package READMEs.
// ---------------------------------------------------------------------------------------

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function linkedFiles(ctx) {
  // BOTH `docs/` globs, through a Set. Git's pathspec `**/` does not match zero
  // directories, so `docs/**/*.md` alone silently drops every file at the TOP of `docs/` —
  // the index this skill ships and all three registers, 67 relative links unchecked. Git's
  // `*` does cross `/`, so `docs/*.md` alone happens to cover both; listing the pair and
  // deduping says which coverage is intended instead of resting on that subtlety, and the
  // Set is what stops the overlap reporting one broken link twice.
  return [
    ...new Set([
      ...ctx.tracked('docs/*.md', 'docs/**/*.md'),
      ...ctx.tracked('*.md').filter(f => !f.includes('/')),
      ...ctx.tracked('packages/*/README.md'),
    ]),
  ];
}

function checkLinks(ctx) {
  for (const file of linkedFiles(ctx)) {
    const text = ctx.read(file);
    // A regex literal inside a fenced block is not a link.
    const parts = text.split(/(^```[\s\S]*?^```$)/m);
    for (let i = 0; i < parts.length; i += 2) {
      for (const match of parts[i].matchAll(LINK)) {
        const raw = match[1];
        if (/^(https?:|mailto:|#)/.test(raw)) continue;
        const target = raw.split('#')[0];
        if (target === '') continue;
        const resolved = posix.normalize(
          posix.join(posix.dirname(file), decodeURIComponent(target)),
        );
        if (!ctx.exists(resolved)) {
          ctx.finding(
            'links',
            'act',
            `${file} links ${raw}, which resolves to a path that does not exist.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// 7. Register text that landed in a specification document instead of a register.
// ---------------------------------------------------------------------------------------

const SPEC_TREES = ['docs/work/**/*.md', 'docs/sdk-documentation/*.md'];
const AGGREGATE_HEADINGS = [
  /^##\s+Open Findings\b/m,
  /^##\s+Deferred Items Log\s*$/m,
  /^##\s+Open Items\s*$/m,
];

function checkRegisterLeakage(ctx) {
  for (const file of ctx.tracked(...SPEC_TREES)) {
    const text = ctx.read(file);
    for (const heading of AGGREGATE_HEADINGS) {
      const match = heading.exec(text);
      if (!match) continue;
      // The roadmap keeps pointer stubs under these names; a stub is a paragraph, not a table.
      const after = text.slice(match.index, match.index + 600);
      if (/^\*\*Moved out on /m.test(after)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      ctx.finding(
        'registers',
        'act',
        `${file}:${String(line)} carries "${match[0].trim()}". An aggregate register belongs ` +
          "at the docs/ root — open-items.md, deferred-items.md or deviations.md. A phase's " +
          'own dated `## Deferred Items` section stays in place; the aggregate does not.',
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// 8. Every `open-items.md <Letter><N>` citation resolves to a real item.
// ---------------------------------------------------------------------------------------

const CITATION = /open-items\.md`?[  ]*(?:§)?\s*([A-Z]\d+)/g;

function citedFiles(ctx) {
  return ctx
    .tracked(
      'packages/**',
      'tests/**',
      'scripts/**',
      'docs/**',
      '*.md',
      '.claude/**',
    )
    .filter(f => /\.(md|mts|ts|mjs|js)$/.test(f))
    .filter(f => !f.startsWith('.changeset/')); // frozen release history
}

/**
 * Every register citation in the repository, with where it sits.
 *
 * Exported because three documents used to state three different, all-wrong counts of it.
 * There is one derivation, and `--only=citations` prints it.
 */
export function registerCitations(ctx) {
  const register = ctx.read('docs/open-items.md');
  const ids = new Set(
    [...register.matchAll(/^### ([A-Z]\d+)\b/gm)].map(m => m[1]),
  );
  const sites = [];
  for (const file of citedFiles(ctx)) {
    const text = ctx.read(file);
    for (const match of text.matchAll(CITATION)) {
      sites.push({
        file,
        line: text.slice(0, match.index).split('\n').length,
        id: match[1],
        resolves: ids.has(match[1]),
      });
    }
  }
  return {ids, sites};
}

function checkRegisterCitations(ctx) {
  const {sites} = registerCitations(ctx);
  for (const site of sites.filter(s => !s.resolves)) {
    ctx.finding(
      'citations',
      'act',
      `${site.file}:${String(site.line)} cites docs/open-items.md ${site.id}, which has no ` +
        '`### <ID>` heading. Item IDs are permanent; a dangling one means the citation, ' +
        'not the register, is wrong.',
    );
  }
}

// ---------------------------------------------------------------------------------------
// 9. The frozen guard is intact, and nothing the skill may write is frozen.
// ---------------------------------------------------------------------------------------

const WRITABLE_SURFACE = [
  'docs/README.md',
  'docs/open-items.md',
  'docs/deferred-items.md',
  'docs/deviations.md',
  'docs/sdk-documentation',
  'docs/work',
  'docs/superpowers',
  'CLAUDE.md',
  'README.md',
];

function checkGuard(ctx) {
  for (const path of WRITABLE_SURFACE) {
    if (isFrozen(path, ctx.root)) {
      ctx.finding(
        'guard',
        'act',
        `${path} is on the writable surface AND matches a frozen entry.`,
      );
    }
  }
  for (const path of [
    'docs/product-spec/04.md',
    'docs/knowledge/notes/x.md',
    'docs/sdk-design-nodejs.md',
  ]) {
    if (!isFrozen(path, ctx.root)) {
      ctx.finding(
        'guard',
        'act',
        `the guard does not refuse ${path}. Run guard.test.mjs.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------

const CHECKS = {
  inbox: checkInbox,
  root: checkRootDocuments,
  claims: checkClaims,
  readmes: checkPackageReadmes,
  links: checkLinks,
  registers: checkRegisterLeakage,
  citations: checkRegisterCitations,
  guard: checkGuard,
};

export const CHECK_NAMES = Object.freeze(Object.keys(CHECKS));

export function probe(only, root = resolveRepoRoot()) {
  const ctx = createContext(root);
  const facts = repositoryFacts(ctx);
  for (const name of only ?? CHECK_NAMES) {
    const check = CHECKS[name];
    if (check === undefined) throw new Error(`unknown check '${name}'`);
    check(ctx, facts);
  }
  return {facts, findings: ctx.findings, ctx};
}

function main(argv) {
  const strict = argv.includes('--strict');
  const onlyArg = argv.find(a => a.startsWith('--only='));
  const only = onlyArg?.slice('--only='.length).split(',');
  const rootArg = argv.find(a => a.startsWith('--root='));

  const {
    facts,
    findings: found,
    ctx,
  } = probe(only, rootArg?.slice('--root='.length) ?? resolveRepoRoot());

  process.stdout.write('housekeeping probe — read-only\n\n');
  process.stdout.write(
    `repository: ${String(facts.packages.length)} packages ` +
      `(${String(facts.publishable.length)} publishable, ${String(facts.privatePackages.length)} private), ` +
      `${String(facts.apiReports.length)} API reports, ` +
      `${String(facts.namedSteps.length)} named CI steps across ${String(facts.jobs.length)} jobs, ` +
      `${String(facts.scripts.length)} package scripts\n`,
  );

  if (only?.includes('citations')) {
    const {ids, sites} = registerCitations(ctx);
    const outside = sites.filter(s => s.file !== 'docs/open-items.md');
    const core = sites.filter(s => s.file.startsWith('packages/core/src/'));
    process.stdout.write(
      `citations: ${String(sites.length)} total, ${String(outside.length)} outside the ` +
        `register, ${String(core.length)} in packages/core/src/, ` +
        `${String(new Set(sites.map(s => s.id)).size)} distinct IDs against ` +
        `${String(ids.size)} items\n`,
    );
  }
  process.stdout.write('\n');

  if (found.length === 0) {
    process.stdout.write('no drift found.\n');
    return 0;
  }

  const byCheck = new Map();
  for (const f of found) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check).push(f);
  }
  for (const [check, items] of byCheck) {
    process.stdout.write(`## ${check} (${String(items.length)})\n`);
    for (const item of items) {
      process.stdout.write(`  [${item.severity}] ${item.message}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    `${String(found.length)} finding(s). This stage writes nothing — read them, then run ` +
      'apply.mjs for the mechanical ones.\n',
  );
  return strict ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
