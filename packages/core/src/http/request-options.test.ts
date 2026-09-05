// SPDX-License-Identifier: MIT
// packages/core/src/http/request-options.test.ts
// Exercises: HTTP-34 (EMPTY sentinel, defensive tag copy), HTTP-35 (timeout/maxRetries validation),
// AUTH-4 (the per-call auth descriptor tier, added in Phase 5c)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {createAuthDescriptor} from '../auth/descriptor.js';
import {createAuthRequirement} from '../auth/requirement.js';
import {RequestOptions} from './request-options.js';
import {RequestOptionsValidationError} from './errors.js';

describe('RequestOptions.EMPTY', () => {
  test('has null timeout, null max-retries, empty tags', () => {
    expect(RequestOptions.EMPTY.timeoutMs).toBeUndefined();
    expect(RequestOptions.EMPTY.maxRetries).toBeUndefined();
    expect(RequestOptions.EMPTY.tag('anything')).toBeUndefined();
  });
});

describe('per-call auth descriptor (AUTH-4)', () => {
  test('EMPTY carries no auth descriptor', () => {
    expect(RequestOptions.EMPTY.auth).toBeUndefined();
  });

  test('the builder stores and the accessor returns the same descriptor instance', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH')]);
    expect(RequestOptions.newBuilder().auth(descriptor).build().auth).toBe(
      descriptor,
    );
  });

  test('an explicit undefined clears the override', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH')]);
    const builder = RequestOptions.newBuilder().auth(descriptor);
    expect(builder.auth(undefined).build().auth).toBeUndefined();
  });

  test('a derived builder carries the descriptor forward (HTTP-3)', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const original = RequestOptions.newBuilder().auth(descriptor).build();
    expect(original.newBuilder().build().auth).toBe(descriptor);
  });
});

describe('operation auth descriptor (AUTH-4, docs/work/mvp/2026-09-04-open-items-dissolution.md W1)', () => {
  test('EMPTY carries no operation descriptor', () => {
    expect(RequestOptions.EMPTY.operationAuth).toBeUndefined();
  });

  test('the builder round-trips the descriptor by reference', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    expect(
      RequestOptions.newBuilder().operationAuth(descriptor).build()
        .operationAuth,
    ).toBe(descriptor);
  });

  test('a derived builder carries the descriptor forward (HTTP-3)', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const original = RequestOptions.newBuilder()
      .operationAuth(descriptor)
      .build();
    expect(original.newBuilder().build().operationAuth).toBe(descriptor);
  });

  test('the two slots are independent — filling one leaves the other unset', () => {
    const perCall = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const operation = createAuthDescriptor([createAuthRequirement('API_KEY')]);
    const options = RequestOptions.newBuilder()
      .auth(perCall)
      .operationAuth(operation)
      .build();
    expect(options.auth).toBe(perCall);
    expect(options.operationAuth).toBe(operation);
  });
});

const timeoutCandidate = fc.oneof(
  fc.double({noNaN: false}),
  fc.integer({min: -10, max: 10}),
  fc.constantFrom(2 ** 32 - 1, 2 ** 32, Number.MAX_SAFE_INTEGER),
);

/**
 * Either the builder refuses `candidate` with the typed error, or it admits a value inside
 * `AbortSignal.timeout()`'s range. There is no third outcome — that is the whole HTTP-35 claim.
 */
function expectAdmittedTimeoutInRange(candidate: number): void {
  let accepted: number | undefined;
  try {
    accepted = RequestOptions.newBuilder()
      .timeoutMs(candidate)
      .build().timeoutMs;
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(RequestOptionsValidationError);
    return;
  }
  expect(Number.isInteger(accepted)).toBe(true);
  expect(accepted).toBeGreaterThanOrEqual(1);
  expect(accepted).toBeLessThanOrEqual(2 ** 32 - 1);
}

describe('timeout validation (HTTP-35)', () => {
  test('rejects zero or negative timeout', () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(0)).toThrow(
      RequestOptionsValidationError,
    );
    expect(() => RequestOptions.newBuilder().timeoutMs(-1)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('rejects a non-finite timeout, the same way maxRetries does (P2)', () => {
    expect(() =>
      RequestOptions.newBuilder().timeoutMs(Number.POSITIVE_INFINITY),
    ).toThrow(RequestOptionsValidationError);
    expect(() => RequestOptions.newBuilder().timeoutMs(Number.NaN)).toThrow(
      RequestOptionsValidationError,
    );
  });

  // Flipped by audit #67 / #76. The old case pinned `timeoutMs(1.5)` as accepted "because a deadline
  // can honor a fractional millisecond". Nothing downstream can: the only consumer is
  // `composeSignal`, which hands the value to `AbortSignal.timeout()`, and that throws
  // `RangeError: The value of "delay" is out of range. It must be an integer.` — inside the
  // transport, one seam away from the setter that accepted it. HTTP-35 puts the range check at the
  // setter, so the range checked is `AbortSignal.timeout()`'s, the only one a transport can honor.
  test('rejects a fractional timeout, which no transport deadline can honor', () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(1.5)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test("rejects a timeout above AbortSignal.timeout()'s ceiling of 2**32 - 1", () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(2 ** 32)).toThrow(
      RequestOptionsValidationError,
    );
    expect(() =>
      RequestOptions.newBuilder().timeoutMs(Number.MAX_SAFE_INTEGER),
    ).toThrow(RequestOptionsValidationError);
  });

  test('accepts the ceiling itself, so the boundary is inclusive', () => {
    expect(
      RequestOptions.newBuilder()
        .timeoutMs(2 ** 32 - 1)
        .build().timeoutMs,
    ).toBe(2 ** 32 - 1);
  });

  // The invariant, stated runtime-independently: a value this setter accepts is inside
  // `AbortSignal.timeout()`'s documented range, and anything else fails here. It is asserted as a
  // property rather than against `AbortSignal.timeout()` itself because the two runtimes disagree —
  // Bun accepts `1.5` and `2**32` where Node raises `RangeError` — which is precisely why the range
  // is checked in the model instead of left to whichever runtime the caller happens to be on.
  // `tests/node-conformance/seams.test.mjs` closes the Node half.
  test('every accepted timeout is an integer in 1..2**32 - 1 (property)', () => {
    fc.assert(
      fc.property(timeoutCandidate, candidate => {
        expectAdmittedTimeoutInRange(candidate);
      }),
      {numRuns: 500},
    );
  });

  test('accepts a null (undefined) timeout — no override', () => {
    expect(() =>
      RequestOptions.newBuilder().timeoutMs(undefined).build(),
    ).not.toThrow();
  });

  test('accepts a positive timeout', () => {
    expect(RequestOptions.newBuilder().timeoutMs(5000).build().timeoutMs).toBe(
      5000,
    );
  });
});

describe('maxRetries validation (HTTP-35)', () => {
  test('rejects a negative maxRetries', () => {
    expect(() => RequestOptions.newBuilder().maxRetries(-1)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('rejects a non-finite maxRetries, which would make a retry loop unbounded', () => {
    // Worse in effect than a negative value: a negative one still fails a downstream `>= 1` guard,
    // while Infinity/NaN make an "attempt >= ceiling" test permanently false and the loop endless.
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => RequestOptions.newBuilder().maxRetries(value)).toThrow(
        RequestOptionsValidationError,
      );
    }
  });

  test('rejects a fractional maxRetries, which is not a count of wire sends', () => {
    expect(() => RequestOptions.newBuilder().maxRetries(1.5)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('accepts 0, meaning "disable retries for this call"', () => {
    expect(RequestOptions.newBuilder().maxRetries(0).build().maxRetries).toBe(
      0,
    );
  });

  test('accepts a positive integer', () => {
    expect(RequestOptions.newBuilder().maxRetries(3).build().maxRetries).toBe(
      3,
    );
  });
});

describe('tags are defensively copied at build (HTTP-34)', () => {
  test('a built options is unaffected by later mutation of the source map', () => {
    const source = new Map([['env', 'prod']]);
    const options = RequestOptions.newBuilder().tags(source).build();
    source.set('env', 'mutated');
    expect(options.tag('env')).toBe('prod');
  });
});

describe('newBuilder derivation (HTTP-3)', () => {
  test('a derived builder is pre-filled with timeout, retries, and tags', () => {
    const original = RequestOptions.newBuilder()
      .timeoutMs(5000)
      .maxRetries(0)
      .tags(new Map([['env', 'prod']]))
      .build();

    const derived = original.newBuilder().maxRetries(3).build();

    expect(derived.timeoutMs).toBe(5000);
    expect(derived.maxRetries).toBe(3);
    expect(derived.tag('env')).toBe('prod');
    expect(original.maxRetries).toBe(0);
  });
});
