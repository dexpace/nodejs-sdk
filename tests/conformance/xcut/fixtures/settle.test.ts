// SPDX-License-Identifier: MIT
// tests/conformance/xcut/fixtures/settle.test.ts
// Exercises: the shared rejection-capturing helper this directory's XCUT-N suites assert through.
// Both branches matter -- a `rejectionOf` that reported `undefined` for a REJECTED promise would make
// every `expect(await rejectionOf(p)).toBeInstanceOf(...)` row in this directory vacuously wrong.
import {describe, expect, test} from 'bun:test';
import {rejectionOf} from './settle.js';

describe('rejectionOf', () => {
  test('hands back the reason a rejected promise carried', async () => {
    const reason = new TypeError('boom');

    expect(await rejectionOf(Promise.reject(reason))).toBe(reason);
  });

  test('hands back a non-Error rejection reason unchanged', async () => {
    // The XCUT-9 row rejects with a cyclic plain object, so the helper must not coerce or wrap.
    const cyclic: {self?: unknown} = {};
    cyclic.self = cyclic;

    /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is exactly the case under test; re-enable if XCUT-9 stops rejecting with a bare cyclic object */
    expect(await rejectionOf(Promise.reject(cyclic))).toBe(cyclic);
  });

  test('reports undefined when the promise resolved instead', async () => {
    expect(await rejectionOf(Promise.resolve('fulfilled'))).toBeUndefined();
  });
});
