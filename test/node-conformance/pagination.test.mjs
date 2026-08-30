// SPDX-License-Identifier: MIT
// test/node-conformance/pagination.test.mjs
//
// Phase 6c's runtime-divergent surface, run against the BUILT artifact on real Node.
//
// Three things in this phase are runtime-divergent across Bun and Node:
//   1. Explicit Resource Management: `Page` installs `[Symbol.asyncDispose]` delegating to `close()`,
//      guarded on the symbol existing — it postdates `engines.node`'s >=20.3 floor (it arrived in 20.4),
//      so this suite's 20.3.0 matrix leg must assert its ABSENCE, not skip the check.
//   2. `AbortSignal` integration: threading signal into every request exchange and halting pagination walks at boundaries.
//   3. `Response.close()` cancelling active `ReadableStream` bodies upon advance, early break, or completion.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Page, pageInfo, Paginator, Request} from '@dexpace/core';
import {
  FakeTransport,
  countingResponse,
} from '../../packages/core/dist/testing/fake-transport.js';

describe('Page explicit resource management on Node (PAGE-3, PAGE-12)', () => {
  // Never index with a bare `Symbol.asyncDispose`. On the >=20.3 floor it is `undefined`, so
  // `page[Symbol.asyncDispose]` reads `page['undefined']` — which used to resolve to a junk prototype
  // entry left by an unguarded `async [Symbol.asyncDispose]()` class member and made this very
  // assertion pass on a Page that could not be disposed at all. Branch on the symbol instead, and
  // check the junk key is gone on both legs.
  it('leaves no "undefined" prototype key on any Node version (guarded install)', () => {
    const {response} = countingResponse(200);
    const page = new Page(response, ['item-1']);
    assert.ok(
      !Object.getOwnPropertyNames(Object.getPrototypeOf(page)).includes(
        'undefined',
      ),
      'Page.prototype carries an "undefined" key: [Symbol.asyncDispose] was declared as a plain class member ahead of the floor bump',
    );
    assert.equal(typeof page.close, 'function');
  });

  it('disposes the page via Symbol.asyncDispose, releasing the response body', async t => {
    if (typeof Symbol.asyncDispose !== 'symbol') {
      t.skip(
        `Symbol.asyncDispose is absent on ${process.version} (arrives in 20.4); the guarded install is correctly a no-op here`,
      );
      return;
    }
    const {response, cancelCount} = countingResponse(200);
    const page = new Page(response, ['item-1', 'item-2']);

    assert.equal(typeof page[Symbol.asyncDispose], 'function');
    assert.deepEqual(page.items, ['item-1', 'item-2']);

    await page[Symbol.asyncDispose]();
    assert.equal(cancelCount(), 1);
    // Metadata survives close (PAGE-2)
    assert.deepEqual(page.items, ['item-1', 'item-2']);
    assert.equal(page.status.code, 200);
  });
});

describe('Paginator iteration and cancellation on Node (PAGE-1, PAGE-25, PAGE-26)', () => {
  it('walks pages and items, closing responses before yielding items (PAGE-11)', async () => {
    const closed = [];
    const r1 = countingResponse({body: '{}', onCancel: () => closed.push(0)});
    const r2 = countingResponse({body: '{}', onCancel: () => closed.push(1)});

    const transport = new FakeTransport([r1, r2]);

    let parseCount = 0;
    const strategy = {
      parse: async () => {
        parseCount += 1;
        const nextReq =
          parseCount === 1
            ? Request.newBuilder()
                .method('GET')
                .url('https://api.test/items?page=2')
                .build()
            : undefined;
        return pageInfo([`item-${parseCount}`], nextReq);
      },
    };

    const initialRequest = Request.newBuilder()
      .method('GET')
      .url('https://api.test/items?page=1')
      .build();

    const paginator = new Paginator({
      transport,
      strategy,
      initialRequest,
    });

    const items = [];
    for await (const item of paginator.items()) {
      items.push(item);
    }

    assert.deepEqual(items, ['item-1', 'item-2']);
    assert.deepEqual(closed, [0, 1]);
    assert.equal(transport.sendCount, 2);
  });

  it('stops walk at page boundary on abort, threading AbortSignal (PAGE-25, PAGE-26)', async () => {
    const controller = new AbortController();
    const responses = Array.from(
      {length: 10},
      () => countingResponse(200).response,
    );
    const transport = new FakeTransport(responses);

    const strategy = {
      parse: async (_res, template) => {
        return pageInfo(['x'], template);
      },
    };

    const initialRequest = Request.newBuilder()
      .method('GET')
      .url('https://api.test/items')
      .build();

    const paginator = new Paginator({
      transport,
      strategy,
      initialRequest,
      signal: controller.signal,
    });

    let delivered = 0;
    for await (const page of paginator.pages()) {
      void page;
      delivered += 1;
      if (delivered === 2) controller.abort();
    }

    assert.equal(delivered, 2);
    assert.equal(transport.sendCount, 2);
    assert.equal(transport.sentSignals.length, 2);
    assert.equal(
      transport.sentSignals.every(s => s === controller.signal),
      true,
    );
  });
});
