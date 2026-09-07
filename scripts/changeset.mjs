// SPDX-License-Identifier: MIT
// scripts/changeset.mjs
//
// Wrapper around the changesets CLI that renames a newly created changeset
// from `@changesets/write`'s random `human-id` name (`silly-pandas-jump.md`)
// to this repo's convention: `YYYY-MM-DD-<kebab-slug>.md`, the same name shape
// every document under `docs/work/mvp/` carries.
//
// The name is not a config knob — the ID comes from a hardcoded `humanId()`
// call inside `@changesets/write`, and `.changeset/config.json`'s schema has
// no filename field. Renaming afterwards is safe because nothing reads the
// filename back: the CLI globs `.changeset/*.md` (skipping `README.md` and
// `config.json`) and takes every decision from the frontmatter.
//
// Every argument is forwarded to `changeset` verbatim. Only the invocations
// that can create a changeset (`add`, or no subcommand) are renamed;
// `version`, `status`, `publish`, `tag`, `pre` and `init` pass through
// untouched.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {fileURLToPath} from 'node:url';

const CHANGESET_DIR = fileURLToPath(new URL('../.changeset', import.meta.url));
const NON_CHANGESET_FILES = new Set(['README.md']);
const PASSTHROUGH_SUBCOMMANDS = new Set([
  'version',
  'status',
  'publish',
  'tag',
  'pre',
  'init',
]);
const MAX_SLUG_LENGTH = 48;

function listChangesets() {
  return readdirSync(CHANGESET_DIR).filter(
    name => name.endsWith('.md') && !NON_CHANGESET_FILES.has(name),
  );
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function toSlug(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean);

  const kept = [];
  let length = 0;
  for (const word of words) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (kept.length > 0 && next > MAX_SLUG_LENGTH) break;
    kept.push(word);
    length = next;
  }
  return kept.join('-').slice(0, MAX_SLUG_LENGTH);
}

// The summary a changeset was written with is the best default name for it.
// Frontmatter is delimited by the first two `---` lines; the summary is the
// first non-empty line after that, cut at its first sentence — these summaries
// open with a title-like clause and then keep going for paragraphs.
function summaryOf(fileName) {
  const lines = readFileSync(join(CHANGESET_DIR, fileName), 'utf8').split('\n');
  const closing = lines.indexOf('---', lines.indexOf('---') + 1);
  const summary = lines.slice(closing + 1).find(line => line.trim() !== '');
  return (summary ?? '').trim().split(/(?<=\.)\s/)[0];
}

function uniqueName(date, slug) {
  const base = `${date}-${slug}`;
  if (!existsSync(join(CHANGESET_DIR, `${base}.md`))) return `${base}.md`;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}.md`;
    if (!existsSync(join(CHANGESET_DIR, candidate))) return candidate;
  }
}

async function askSlug(fallback) {
  // Non-interactive callers (CI, a scripted `--empty`) get the derived slug
  // rather than a hang on a prompt nobody can answer.
  if (!stdin.isTTY) return fallback;
  const rl = createInterface({input: stdin, output: stdout});
  try {
    const answer = await rl.question(`Changeset slug (${fallback}): `);
    const slug = toSlug(answer);
    return slug === '' ? fallback : slug;
  } finally {
    rl.close();
  }
}

async function rename(fileName) {
  const derived = toSlug(summaryOf(fileName)) || 'changeset';
  const target = uniqueName(today(), await askSlug(derived));
  renameSync(join(CHANGESET_DIR, fileName), join(CHANGESET_DIR, target));
  console.log(`Renamed ${fileName} -> ${target}`);
}

const args = process.argv.slice(2);
const creates = !PASSTHROUGH_SUBCOMMANDS.has(args[0] ?? 'add');
const before = creates ? new Set(listChangesets()) : new Set();

const result = spawnSync('bunx', ['changeset', ...args], {stdio: 'inherit'});
if (result.status !== 0) process.exit(result.status ?? 1);

if (creates) {
  for (const fileName of listChangesets().filter(name => !before.has(name))) {
    await rename(fileName);
  }
}
