// SPDX-License-Identifier: MIT
// packages/rx/src/from-async-iterable.conformance.test.ts
//
// Exercises: ASYNC-21 (poll-once-per-demand under a synchronous subscriber, complete on end-of-source,
// propagate a source error as an error signal), ASYNC-13 (no wrapper exception around a thrown value),
// ASYNC-6 (unsubscribe reaches the source's .return() exactly once across synchronous and asynchronous paths).
//
// This suite tests fromAsyncIterable against a hand-built async generator / iterator test double, deliberately not
// SseStream/Paginator, to isolate "does the async-iterable bridge satisfy the contract" from "does 6b/6c's own close discipline
// work" (already proven in their own test suites).
//
// The final describe block is the one that runs against rxjs's OWN from(), not ours: it pins the single
// ASYNC-6 clause the native operator fails, which is the entire justification for this package shipping a
// hand-written bridge instead of the one-liner its plan called for. If that case ever fails, RxJS has closed
// the gap and `from-async-iterable.ts` should be deleted in favor of `from()`.
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, from, take, toArray} from 'rxjs';
import {fromAsyncIterable} from './from-async-iterable.js';

async function* countTo(
  n: number,
  onReturn?: () => void,
): AsyncGenerator<number> {
  try {
    for (let i = 1; i <= n; i++) {
      await Promise.resolve();
      yield i;
    }
  } finally {
    onReturn?.();
  }
}

function makePendingIterableDouble(
  onReturn?: () => void,
): AsyncIterable<number> {
  let returned = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<number, void>> {
          if (returned) {
            return Promise.resolve({done: true, value: undefined});
          }
          return new Promise<IteratorResult<number, void>>(() => {
            // never settles
          });
        },
        return(): Promise<IteratorResult<number, void>> {
          returned = true;
          onReturn?.();
          return Promise.resolve({done: true, value: undefined});
        },
      };
    },
  };
}

describe('fromAsyncIterable — ASYNC-21', () => {
  test('polls the source once per emission, never ahead of demand', async () => {
    let pulls = 0;
    async function* spy(): AsyncGenerator<number> {
      for (let i = 1; i <= 10; i++) {
        await Promise.resolve();
        pulls++;
        yield i;
      }
    }

    // The source deliberately outlives demand. A generator yielding exactly as many values as the
    // subscriber consumes cannot tell one-pull-per-emission apart from a bridge that prefetches -- it has
    // nothing left to prefetch, so the assertion passes either way. Ten available, two taken, two pulled.
    const values = await firstValueFrom(
      fromAsyncIterable(spy()).pipe(take(2), toArray()),
    );
    expect(values).toEqual([1, 2]);
    expect(pulls).toBe(2);
  });

  test('completes the Observable when the source generator returns', async () => {
    const values = await firstValueFrom(
      fromAsyncIterable(countTo(2)).pipe(toArray()),
    );
    expect(values).toEqual([1, 2]);
  });

  test('a source throw surfaces via the error channel with the original value, unwrapped', async () => {
    async function* throwing(): AsyncGenerator<number> {
      await Promise.resolve();
      yield 1;
      throw new RangeError('boom');
    }
    const errors: unknown[] = [];
    await new Promise<void>(resolve => {
      fromAsyncIterable(throwing()).subscribe({
        next() {
          // ignore
        },
        error(err: unknown) {
          errors.push(err);
          resolve();
        },
      });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as RangeError).message).toBe('boom'); // ASYNC-13: not wrapped in an RxJS-internal type
  });
});

describe('fromAsyncIterable — ASYNC-6 (synchronous & asynchronous cancellation)', () => {
  test("unsubscribing mid-stream synchronously calls the generator's .return() exactly once", async () => {
    let returns = 0;
    const generator = countTo(5, () => {
      returns++;
    });
    await new Promise<void>(resolve => {
      const subscription = fromAsyncIterable(generator).subscribe({
        next(value) {
          if (value === 2) {
            subscription.unsubscribe();
            // allow the microtask queue to settle the generator's finally block
            setTimeout(resolve, 10);
          }
        },
      });
    });
    expect(returns).toBe(1);
  });

  test('unsubscribing asynchronously while idle awaiting .next() calls .return() immediately', async () => {
    let returns = 0;
    let pushNextValue!: (val: number) => void;

    const stream: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        let isDone = false;
        let pendingResolve:
          ((res: IteratorResult<number, void>) => void) | undefined;
        pushNextValue = (val: number) => {
          if (pendingResolve) {
            const r = pendingResolve;
            pendingResolve = undefined;
            r({done: false, value: val});
          }
        };
        return {
          next() {
            if (isDone) {
              return Promise.resolve({done: true, value: undefined});
            }
            return new Promise<IteratorResult<number, void>>(resolve => {
              pendingResolve = resolve;
            });
          },
          return() {
            isDone = true;
            returns++;
            return Promise.resolve({done: true, value: undefined});
          },
        };
      },
    };

    const received: number[] = [];
    const subscription = fromAsyncIterable(stream).subscribe({
      next(value) {
        received.push(value);
      },
    });

    // Push first value
    pushNextValue(1);
    await new Promise(r => setTimeout(r, 10));
    expect(received).toEqual([1]);
    expect(returns).toBe(0);

    // Unsubscribe while waiting for second value
    subscription.unsubscribe();
    expect(returns).toBe(1);
  });
});

describe('fromAsyncIterable — ASYNC-6 (edge release handling)', () => {
  test('unsubscribing before first emission calls .return() immediately', () => {
    let returns = 0;
    const iterable = makePendingIterableDouble(() => {
      returns++;
    });

    const subscription = fromAsyncIterable(iterable).subscribe({
      next() {
        // ignore
      },
    });

    subscription.unsubscribe();
    expect(returns).toBe(1);
  });

  test('unsubscribing swallows release failures from close() or return() per ASYNC-21 / SSE-30', async () => {
    const iterable = {
      close(): Promise<void> {
        return Promise.reject(new Error('close failed'));
      },
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<number, void>> {
            return new Promise<IteratorResult<number, void>>(() => {
              // never settles
            });
          },
          return(): Promise<IteratorResult<number, void>> {
            return Promise.reject(new Error('return failed'));
          },
        };
      },
    };

    const subscription = fromAsyncIterable(iterable).subscribe({
      next() {
        // ignore
      },
    });

    // Should not throw unhandled rejection
    subscription.unsubscribe();
    await new Promise(r => setTimeout(r, 20));
  });
});

describe('fromAsyncIterable — ASYNC-6 (caller-supplied source release)', () => {
  test('releases the source before returning the iterator, so a suspended pull can settle', async () => {
    const order: string[] = [];
    let settlePendingPull: (() => void) | undefined;

    const iterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<number, void>> {
            return new Promise<IteratorResult<number, void>>(resolve => {
              settlePendingPull = () => {
                resolve({done: true, value: undefined});
              };
            });
          },
          return(): Promise<IteratorResult<number, void>> {
            order.push('return');
            return Promise.resolve({done: true, value: undefined});
          },
        };
      },
    };

    const subscription = fromAsyncIterable(iterable, () => {
      order.push('release');
      settlePendingPull?.();
      return Promise.resolve();
    }).subscribe({
      next() {
        // ignore
      },
    });

    subscription.unsubscribe();
    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['release', 'return']);
  });

  test('a rejected release does not surface from unsubscribe()', () => {
    const iterable: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<number, void>> {
            return new Promise<IteratorResult<number, void>>(() => {
              // never settles
            });
          },
        };
      },
    };

    const subscription = fromAsyncIterable(iterable, () =>
      Promise.reject(new Error('release failed')),
    ).subscribe({
      next() {
        // ignore
      },
    });

    expect(() => {
      subscription.unsubscribe();
    }).not.toThrow();
  });
});

describe("rxjs's own from() — the ASYNC-6 gap this module exists to close", () => {
  test('does NOT reach the source when unsubscribed while a pull is suspended', async () => {
    let returns = 0;
    const iterable = makePendingIterableDouble(() => {
      returns++;
    });

    const subscription = from(iterable).subscribe({
      next() {
        // ignore
      },
    });
    subscription.unsubscribe();
    await new Promise(r => setTimeout(r, 20));

    // Deliberately asserting the DEFECT, not the fix. rxjs 7's async-iterable path only tests
    // subscriber.closed after a pull resolves, so an idle SSE stream is never released. When this
    // expectation starts failing, `fromAsyncIterable` has become redundant -- see this file's header.
    expect(returns).toBe(0);

    // The same source through this module's bridge is released immediately.
    let bridgedReturns = 0;
    const bridged = fromAsyncIterable(
      makePendingIterableDouble(() => {
        bridgedReturns++;
      }),
    ).subscribe({
      next() {
        // ignore
      },
    });
    bridged.unsubscribe();
    expect(bridgedReturns).toBe(1);
  });
});
