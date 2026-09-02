// SPDX-License-Identifier: MIT
// .claude/skills/housekeeping/check-fences.test.mjs
//
// The classifier decides which fences are checked at all, so getting it wrong is silent by
// construction: the run reports PASS over the examples it skipped. It did. A single-line
// `/^import .*'@dexpace\//m` reclassified every fence whose import list wraps — the
// documentation's four largest worked examples — and breaking one of them still printed
// PASS with exit 0.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {extract} from './check-fences.mjs';
import {FrozenPathError} from './guard.mjs';

function withTree(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'fences-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), {recursive: true});
      writeFileSync(join(root, path), text);
    }
    return body(root);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

const WRAPPED = `# doc

\`\`\`typescript
import {
  Request,
  Response,
  type Transport,
} from '@dexpace/core';

export const t: Transport = null as never;
\`\`\`
`;

const SINGLE_LINE = `# doc

\`\`\`typescript
import {Request} from '@dexpace/core';
\`\`\`
`;

const FRAGMENT = `# doc

\`\`\`typescript
interface Transport {
  close(): Promise<void>;
}
\`\`\`
`;

const RELATIVE = `# doc

\`\`\`typescript
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {myTransport} from '../src/index.js';
\`\`\`
`;

test('a fence whose import list WRAPS is runnable, not a fragment', () => {
  withTree({'a.md': WRAPPED}, root => {
    const written = extract('out', ['a.md'], root);
    assert.equal(written.length, 1, 'a wrapped import must not be skipped');
    assert.match(
      readFileSync(join(root, 'out', written[0].name), 'utf8'),
      /@dexpace\/core/,
    );
  });
});

test('a single-line import is runnable', () => {
  withTree({'a.md': SINGLE_LINE}, root => {
    assert.equal(extract('out', ['a.md'], root).length, 1);
  });
});

test('a fence with no @dexpace specifier is an illustrative fragment', () => {
  withTree({'a.md': FRAGMENT}, root => {
    assert.deepEqual(extract('out', ['a.md'], root), []);
  });
});

test('a fence importing a RELATIVE path is package-local and skipped', () => {
  withTree({'a.md': RELATIVE}, root => {
    assert.deepEqual(extract('out', ['a.md'], root), []);
  });
});

test('every written entry records where it came from, with a line number', () => {
  withTree({'docs/a.md': `intro\n\n${SINGLE_LINE}`}, root => {
    const [entry] = extract('out', ['docs/a.md'], root);
    assert.equal(entry.from, 'docs/a.md:5');
    assert.ok(entry.name.endsWith('.ts'));
  });
});

test('a snippet from a root-level file gets a non-dotfile name', () => {
  // `basename(dirname('README.md'))` is `.`, and tsconfig's `include: ["*.ts"]` does not
  // match a dotfile — the whole run reported "No inputs were found".
  withTree({'README.md': SINGLE_LINE}, root => {
    const [entry] = extract('out', ['README.md'], root);
    assert.ok(!entry.name.startsWith('.'), entry.name);
    assert.match(entry.name, /^root-README-1\.ts$/);
  });
});

test('the generated tsconfig turns on the flags the check depends on', () => {
  withTree({'a.md': SINGLE_LINE}, root => {
    extract('out', ['a.md'], root);
    const config = JSON.parse(
      readFileSync(join(root, 'out', 'tsconfig.json'), 'utf8'),
    );
    assert.equal(config.compilerOptions.strict, true);
    assert.equal(config.compilerOptions.noUnusedLocals, true);
    assert.equal(config.compilerOptions.module, 'NodeNext');
    assert.deepEqual(config.compilerOptions.types, []);
  });
});

test('importLines marks a wrapped declaration, so an unused LOCAL is told from an unused IMPORT', () => {
  withTree({'a.md': WRAPPED}, root => {
    const [entry] = extract('out', ['a.md'], root);
    // The declaration spans lines 1-5; the binding on 7 is a local.
    assert.deepEqual(
      [...entry.importLines].sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
    );
    assert.ok(!entry.importLines.has(7));
  });
});

test('extract refuses a frozen output directory', () => {
  // It opens by deleting `dir`. No caller passes anything but the module constant today —
  // these tests are the first to pass a `dir` at all, which is why the guard is here.
  withTree({'a.md': SINGLE_LINE}, root => {
    assert.throws(
      () => extract('docs/product-spec', ['a.md'], root),
      FrozenPathError,
    );
    assert.throws(
      () => extract('docs/knowledge/harvested', ['a.md'], root),
      FrozenPathError,
    );
  });
});
