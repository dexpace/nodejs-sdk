// SPDX-License-Identifier: MIT
// packages/core/src/testing/fake-transport.test.ts
// Exercises the double's own contract: scripted ordering, last-entry repetition, call recording, and
// the close-observation mechanism every later retry test depends on (RETRY-35/RETRY-36).
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {Status} from '../http/status.js';
import {FakeTransport, countingResponse} from './fake-transport.js';

const request = Request.newBuilder().url('https://example.com').build();

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this
 * runner's type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper
 * keeps the assertion honest without a lint suppression.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('FakeTransport', () => {
  test('serves scripted responses in order', async () => {
    const first = countingResponse(503).response;
    const second = countingResponse(200).response;
    const transport = new FakeTransport([first, second]);

    expect(await transport.send(request)).toBe(first);
    expect(await transport.send(request)).toBe(second);
  });

  test('repeats the last scripted entry once exhausted', async () => {
    const only = countingResponse(200).response;
    const transport = new FakeTransport([only]);

    await transport.send(request);
    expect(await transport.send(request)).toBe(only);
    expect(transport.sendCount).toBe(2);
  });

  test('a scripted Error is thrown, not returned', async () => {
    const boom = new Error('connection refused');
    const transport = new FakeTransport([boom]);

    expect(await rejectionOf(transport.send(request))).toBe(boom);
  });

  test('records the request, options, and signal of every send', async () => {
    const controller = new AbortController();
    const transport = new FakeTransport([countingResponse(200).response]);

    await transport.send(request, undefined, controller.signal);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.request).toBe(request);
    expect(transport.calls[0]?.signal).toBe(controller.signal);
  });

  test('an empty script is a programmer error', () => {
    expect(() => new FakeTransport([])).toThrow();
  });

  test('close releases nothing and resolves', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);

    await transport.close();

    expect(transport.sendCount).toBe(0);
  });
});

describe('countingResponse', () => {
  test('reports the requested status', () => {
    expect(countingResponse(503).response.status).toEqual(Status.of(503));
  });

  test('cancelCount observes close without patching the frozen Response', async () => {
    const {response, cancelCount} = countingResponse(503);
    expect(cancelCount()).toBe(0);

    await response.close();

    expect(cancelCount()).toBe(1);
  });

  test('close is idempotent, so the body is cancelled at most once', async () => {
    const {response, cancelCount} = countingResponse(503);

    await response.close();
    await response.close();

    expect(cancelCount()).toBe(1);
  });

  test('a fully drained body is observed as released too, via pull rather than cancel', async () => {
    const {response, cancelCount} = countingResponse(503);
    const reader = response.body?.getReader();
    for (;;) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
    }

    expect(cancelCount()).toBe(1);
  });
});
