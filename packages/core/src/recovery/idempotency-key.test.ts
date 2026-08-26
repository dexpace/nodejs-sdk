// SPDX-License-Identifier: MIT
// packages/core/src/recovery/idempotency-key.test.ts
// Exercises: RECOV-32 (method gating, respect-existing default, strategy invoked at most once per
// applicable request, other methods untouched, defensive method-set copy).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import type {Method} from '../http/method.js';
import {Request} from '../http/request.js';
import {idempotencyKeyStep} from './idempotency-key.js';

function aRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  existing?: string,
): Request {
  const builder = Request.newBuilder()
    .method(method)
    .url('https://example.com');
  if (existing === undefined) return builder.build();
  return builder
    .headers(Headers.newBuilder().add('Idempotency-Key', existing).build())
    .build();
}

describe('idempotencyKeyStep', () => {
  test('stamps the default header on POST, PUT, and PATCH', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      const stamped = await step(aRequest(method));
      expect(stamped.headers.get('Idempotency-Key')).toBe('generated');
    }
  });

  test('passes other methods through untouched', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    const request = aRequest('GET');
    expect(await step(request)).toBe(request);
  });

  test('respects an existing header by default and does NOT invoke the strategy', async () => {
    let invocations = 0;
    const step = idempotencyKeyStep({
      generate: () => {
        invocations += 1;
        return 'generated';
      },
    });
    const request = aRequest('POST', 'caller-supplied');

    const result = await step(request);

    expect(result).toBe(request);
    expect(invocations).toBe(0);
  });

  test('overwrites an existing header when respectExisting is false', async () => {
    const step = idempotencyKeyStep({
      generate: () => 'generated',
      respectExisting: false,
    });
    const stamped = await step(aRequest('POST', 'caller-supplied'));
    expect(stamped.headers.get('Idempotency-Key')).toBe('generated');
  });

  test('invokes the strategy at most once per applicable request', async () => {
    let invocations = 0;
    const step = idempotencyKeyStep({
      generate: () => {
        invocations += 1;
        return `key-${String(invocations)}`;
      },
    });

    await step(aRequest('POST'));

    expect(invocations).toBe(1);
  });
});

describe('idempotencyKeyStep configuration (RECOV-32)', () => {
  test('honors a configured header name and method set', async () => {
    const step = idempotencyKeyStep({
      generate: () => 'generated',
      headerName: 'X-Request-Id',
      methods: new Set<Method>(['GET']),
    });
    expect((await step(aRequest('GET'))).headers.get('X-Request-Id')).toBe(
      'generated',
    );
    const post = aRequest('POST');
    expect(await step(post)).toBe(post);
  });

  test('defensively copies the method set', async () => {
    const methods = new Set<Method>(['GET']);
    const step = idempotencyKeyStep({generate: () => 'generated', methods});
    methods.add('POST');

    const post = aRequest('POST');

    expect(await step(post)).toBe(post);
  });

  test('never mutates the request it was given', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    const request = aRequest('POST');

    await step(request);

    expect(request.headers.get('Idempotency-Key')).toBeUndefined();
  });
});
