// SPDX-License-Identifier: MIT
// scripts/verify-sse-37.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findForbiddenSerdeImports} from './verify-sse-37.mjs';

test('a clean sse/ tree reports no violations', () => {
  assert.deepEqual(findForbiddenSerdeImports('packages/core/src/sse'), []);
});

test('a relative serde import is caught', () => {
  const found = findForbiddenSerdeImports('packages/core/src/sse', [
    {file: 'fake.ts', source: "import {Tristate} from '../serde/tristate.js';"},
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].specifier, '../serde/tristate.js');
});

test('the serde seam and the codec package are both caught', () => {
  const found = findForbiddenSerdeImports('packages/core/src/sse', [
    {file: 'a.ts', source: "import type {Serde} from '../seams/serde.js';"},
    {file: 'b.ts', source: "import {jsonSerde} from '@dexpace/codec-json';"},
  ]);
  assert.equal(found.length, 2);
});

test('an unrelated import is not caught', () => {
  const found = findForbiddenSerdeImports('packages/core/src/sse', [
    {file: 'a.ts', source: "import {IoError} from '../io/errors.js';"},
  ]);
  assert.deepEqual(found, []);
});

test('a reconnect path or Last-Event-ID header is caught (SSE-38)', () => {
  assert.equal(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {file: 'a.ts', source: "headers.set('Last-Event-ID', event.id);"},
    ]).length,
    1,
  );
  assert.equal(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {
        file: 'b.ts',
        source: 'async function reconnect() { return fetch(url); }',
      },
    ]).length,
    2,
  );
});

test('documenting the ABSENCE of reconnection is not a violation (SSE-38)', () => {
  // The gate has to survive its own requirement being explained, or the first TSDoc that says so gets the gate
  // deleted instead of the sentence. Comments are stripped before the marker scan.
  assert.deepEqual(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {
        file: 'stream.ts',
        source: [
          '/**',
          ' * This subsystem never reconnects and never sets a Last-Event-ID header (SSE-38);',
          ' * reconnection is the caller`s job, as is any call to fetch(...) that resumes a stream.',
          ' */',
          'export class SseStream {}',
        ].join('\n'),
      },
    ]),
    [],
  );
});

test('a commented-out serde import is not a violation either', () => {
  assert.deepEqual(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {
        file: 'a.ts',
        source: "// import {Tristate} from '../serde/tristate.js';",
      },
    ]),
    [],
  );
});

test('reconnect markers are not scanned in test files, but serde imports still are', () => {
  assert.deepEqual(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {
        file: 'stream.test.ts',
        source: 'const stub = () => fetch(url); // a double may say this',
      },
    ]),
    [],
  );
  assert.equal(
    findForbiddenSerdeImports('packages/core/src/sse', [
      {
        file: 'stream.test.ts',
        source: "import {jsonSerde} from '@dexpace/codec-json';",
      },
    ]).length,
    1,
  );
});

test('side-effect and dynamic serde imports are caught (SSE-37)', () => {
  const found = findForbiddenSerdeImports('packages/core/src/sse', [
    {file: 'a.ts', source: "import '@dexpace/codec-json';"},
    {file: 'b.ts', source: "const m = await import('../serde/tristate.js');"},
  ]);
  assert.equal(found.length, 2);
});
