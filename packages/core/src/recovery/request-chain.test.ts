// SPDX-License-Identifier: MIT
// packages/core/src/recovery/request-chain.test.ts
// Exercises: RECOV-3 (sequential left-to-right fold, empty chain is the identity, a throwing step
// aborts the remainder and propagates), RECOV-14 (defensive copy of the step list at construction)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Request} from '../http/request.js';
import {RequestRecoveryChain, type RequestStep} from './request-chain.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function tagAppendStep(char: string): RequestStep {
  return request => {
    const current = request.headers.get('X-Trace') ?? '';
    return Promise.resolve(
      request
        .newBuilder()
        .headers(
          request.headers
            .newBuilder()
            .set('X-Trace', current + char)
            .build(),
        )
        .build(),
    );
  };
}

/** Awaits `promise`, returning whatever it rejected with — `undefined` when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('RequestRecoveryChain.apply (RECOV-3)', () => {
  test('an empty chain returns the input unchanged', async () => {
    const chain = new RequestRecoveryChain([]);
    const request = aRequest();

    const result = await chain.apply(request);

    expect(result).toBe(request);
  });

  test('applies steps as a sequential left-to-right fold', async () => {
    const chain = new RequestRecoveryChain([
      tagAppendStep('a'),
      tagAppendStep('b'),
      tagAppendStep('c'),
    ]);

    const result = await chain.apply(aRequest());

    expect(result.headers.get('X-Trace')).toBe('abc');
  });

  test('a throwing step aborts the remainder and propagates', async () => {
    const reached: string[] = [];
    const thrownError = new Error('step failed');
    const failingStep: RequestStep = () => {
      throw thrownError;
    };
    const laterStep: RequestStep = request => {
      reached.push('later');
      return Promise.resolve(request);
    };
    const chain = new RequestRecoveryChain([
      tagAppendStep('a'),
      failingStep,
      laterStep,
    ]);

    expect(await rejection(chain.apply(aRequest()))).toBe(thrownError);
    expect(reached).toEqual([]);
  });
});

describe('RequestRecoveryChain construction (RECOV-14)', () => {
  test('defensively copies its step list — mutating the source after construction has no effect', async () => {
    const steps: RequestStep[] = [tagAppendStep('a')];
    const chain = new RequestRecoveryChain(steps);
    steps.push(tagAppendStep('b'));

    const result = await chain.apply(aRequest());

    expect(result.headers.get('X-Trace')).toBe('a');
  });
});

describe('RequestRecoveryChain.apply fold law', () => {
  // Canonical law for an invariant-bearing function: applying the chain equals manually reducing
  // the same steps in order, for an arbitrary sequence of single-character append steps.
  test('apply() equals a manual left-to-right reduce, for arbitrary step sequences', async () => {
    await fc.assert(
      // `fc.string({minLength: 1, maxLength: 1})` rather than `fc.char()`: the latter is deprecated
      // in fast-check 3.22+ and would print a deprecation warning on every run.
      fc.asyncProperty(
        fc.array(fc.string({minLength: 1, maxLength: 1}), {maxLength: 10}),
        async chars => {
          const steps = chars.map(tagAppendStep);
          const chain = new RequestRecoveryChain(steps);

          const chained = await chain.apply(aRequest());
          let manual = aRequest();
          for (const step of steps) manual = await step(manual);

          expect(chained.headers.get('X-Trace')).toBe(
            manual.headers.get('X-Trace'),
          );
        },
      ),
    );
  });
});

describe('RECOV-14: steps are safe for concurrent invocation', () => {
  // RECOV-14's second normative clause binds both chains, not only the response one: per-request
  // state lives in the value being transformed, never on the step or the chain instance. Guards
  // the structural property that `apply()`'s only per-call state is its `current` local.
  test('two interleaved apply() calls on ONE chain instance do not observe each other', async () => {
    const gate: (() => void)[] = [];
    const slowStep: RequestStep = async request => {
      await new Promise<void>(resolve => gate.push(resolve));
      return request;
    };
    const chain = new RequestRecoveryChain([slowStep, tagAppendStep('x')]);
    const first = Request.newBuilder().url('https://example.com/first').build();
    const second = Request.newBuilder()
      .url('https://example.com/second')
      .build();

    const firstCall = chain.apply(first);
    const secondCall = chain.apply(second);
    await Promise.resolve();
    for (const release of gate) release();
    const [firstResult, secondResult] = await Promise.all([
      firstCall,
      secondCall,
    ]);

    expect(firstResult.url.pathname).toBe('/first');
    expect(secondResult.url.pathname).toBe('/second');
    expect(firstResult.headers.get('X-Trace')).toBe('x');
    expect(secondResult.headers.get('X-Trace')).toBe('x');
  });
});
