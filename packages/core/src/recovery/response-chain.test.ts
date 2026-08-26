// SPDX-License-Identifier: MIT
// packages/core/src/recovery/response-chain.test.ts
// Exercises: RECOV-4 (response steps run only on a Success), RECOV-5/RECOV-6 (recovery steps run on
// every outcome; fold order is all response steps then all recovery steps), RECOV-7 (a throwing
// response step becomes a Failure fed to recovery, never propagated), RECOV-8 (a throwing recovery
// step becomes a Failure fed to the NEXT recovery step; apply() never throws), RECOV-12
// (close-on-throw while holding a Success, close failure attached as `suppressed` with the original
// throwable staying primary), RECOV-13 (a deliberately returned substitute outcome is never
// auto-closed), RECOV-14 (both step lists defensively copied, and steps safe for concurrent
// invocation — no per-call state on the chain instance)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {failure, success, type Outcome} from './outcome.js';
import {
  ResponseRecoveryChain,
  type RecoveryStep,
  type ResponseStep,
} from './response-chain.js';

function aResponse(body: ReadableStream<Uint8Array> | null = null): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

/**
 * Close is observed through the body stream's `cancel()`, exactly the way Phase 3b's own
 * `response.test.ts` observes it — NOT by patching `response.close`. `Response` calls
 * `Object.freeze(this)` at the end of its constructor, so `response.close = ...` throws
 * `TypeError: Cannot add property close, object is not extensible` in an ES module's strict mode.
 * `Response.close()` is memoized and cancels the body at most once, so the cancel count IS the
 * effective-close count RECOV-12's "released exactly once" asks about.
 */
function countingCloseResponse(): {
  response: Response;
  closeCount: () => number;
} {
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      cancels += 1;
    },
  });
  return {response: aResponse(body), closeCount: () => cancels};
}

/**
 * A response whose `close()` rejects. `Response.close()` awaits `body.cancel()` and swallows only
 * `TypeError` (the locked-stream case), so a plain `Error` propagates out of `close()`.
 */
function failingCloseResponse(closeError: Error): Response {
  return aResponse(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        throw closeError;
      },
    }),
  );
}

describe('response-step phase (RECOV-4, RECOV-6)', () => {
  test('response steps run in order on a Success outcome', async () => {
    const seen: string[] = [];
    const stepA: ResponseStep = r => {
      seen.push('a');
      return Promise.resolve(r);
    };
    const stepB: ResponseStep = r => {
      seen.push('b');
      return Promise.resolve(r);
    };
    const chain = new ResponseRecoveryChain([stepA, stepB], []);

    await chain.apply(success(aResponse()));

    expect(seen).toEqual(['a', 'b']);
  });

  test('response steps do not run when the input outcome is already a Failure', async () => {
    const original = new Error('original');
    const stepShouldNotRun: ResponseStep = () => {
      throw new Error('must not run');
    };
    const chain = new ResponseRecoveryChain([stepShouldNotRun], []);

    const result = await chain.apply(failure(original));

    expect(result.kind).toBe('failure');
    expect(result.kind === 'failure' && result.error).toBe(original);
  });
});

describe('recovery-step phase (RECOV-5, RECOV-6)', () => {
  test('recovery steps run on every outcome, successes and failures, in order', async () => {
    const seenKinds: string[] = [];
    const record: RecoveryStep = outcome => {
      seenKinds.push(outcome.kind);
      return Promise.resolve(outcome);
    };
    const chain = new ResponseRecoveryChain([], [record, record]);

    await chain.apply(success(aResponse()));
    await chain.apply(failure(new Error('x')));

    expect(seenKinds).toEqual(['success', 'success', 'failure', 'failure']);
  });

  test('fold order is all response steps first, then all recovery steps', async () => {
    const order: string[] = [];
    const responseStep: ResponseStep = r => {
      order.push('response');
      return Promise.resolve(r);
    };
    const recoveryStep: RecoveryStep = outcome => {
      order.push('recovery');
      return Promise.resolve(outcome);
    };
    const chain = new ResponseRecoveryChain([responseStep], [recoveryStep]);

    await chain.apply(success(aResponse()));

    expect(order).toEqual(['response', 'recovery']);
  });
});

describe('RECOV-7: a throwing response step converts to a Failure fed to recovery', () => {
  test('the throwable never propagates out of apply(), and recovery observes the Failure', async () => {
    const stepAfterThatMustNotRun: ResponseStep = () => {
      throw new Error(
        'must not run — the response phase stops after the throw',
      );
    };
    const thrownError = new Error('response step failed');
    const throwingStep: ResponseStep = () => {
      throw thrownError;
    };
    const seenByRecovery: Outcome<Response>[] = [];
    const recoveryStep: RecoveryStep = outcome => {
      seenByRecovery.push(outcome);
      return Promise.resolve(outcome);
    };
    const chain = new ResponseRecoveryChain(
      [throwingStep, stepAfterThatMustNotRun],
      [recoveryStep],
    );

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
    expect(result.kind === 'failure' && result.error).toBe(thrownError);
    expect(seenByRecovery).toHaveLength(1);
    expect(seenByRecovery[0]?.kind).toBe('failure');
  });
});

describe('RECOV-8: a throwing recovery step wraps into a Failure fed to the next step', () => {
  test('apply() never throws, and the remaining recovery steps still run', async () => {
    const secondStepSeen: Outcome<Response>[] = [];
    const throwingRecoveryStep: RecoveryStep = () => {
      throw new Error('recovery step failed');
    };
    const secondRecoveryStep: RecoveryStep = outcome => {
      secondStepSeen.push(outcome);
      return Promise.resolve(outcome);
    };
    const chain = new ResponseRecoveryChain(
      [],
      [throwingRecoveryStep, secondRecoveryStep],
    );

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
    expect(secondStepSeen).toHaveLength(1);
    expect(secondStepSeen[0]?.kind).toBe('failure');
  });
});

describe('RECOV-12: close-on-throw while holding a Success', () => {
  test('closes the in-hand response exactly once before wrapping the throwable', async () => {
    const {response, closeCount} = countingCloseResponse();
    const thrownError = new Error('step failed');
    const throwingStep: ResponseStep = () => {
      throw thrownError;
    };
    const chain = new ResponseRecoveryChain([throwingStep], []);

    const result = await chain.apply(success(response));

    expect(closeCount()).toBe(1);
    expect(result.kind === 'failure' && result.error).toBe(thrownError);
  });

  test('a close failure is attached as suppressed, with the original throwable staying primary', async () => {
    const closeError = new Error('close failed');
    const response = failingCloseResponse(closeError);
    const originalError = new Error('step failed');
    const throwingStep: ResponseStep = () => {
      throw originalError;
    };
    const chain = new ResponseRecoveryChain([throwingStep], []);

    const result = await chain.apply(success(response));

    expect(result.kind).toBe('failure');
    const wrapped = result.kind === 'failure' ? result.error : undefined;
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as SuppressedErrorShape).name).toBe('SuppressedError');
    expect((wrapped as SuppressedErrorShape).error).toBe(originalError);
    expect((wrapped as SuppressedErrorShape).suppressed).toBe(closeError);
  });

  test('a throwing recovery step holding a Success also closes it exactly once', async () => {
    const {response, closeCount} = countingCloseResponse();
    const thrownError = new Error('recovery step failed');
    const throwingRecoveryStep: RecoveryStep = () => {
      throw thrownError;
    };
    const chain = new ResponseRecoveryChain([], [throwingRecoveryStep]);

    const result = await chain.apply(success(response));

    expect(closeCount()).toBe(1);
    expect(result.kind === 'failure' && result.error).toBe(thrownError);
  });

  test('a throwing step holding a Failure closes nothing — there is no response in hand', async () => {
    const thrownError = new Error('recovery step failed');
    const throwingRecoveryStep: RecoveryStep = () => {
      throw thrownError;
    };
    const chain = new ResponseRecoveryChain([], [throwingRecoveryStep]);

    const result = await chain.apply(failure(new Error('seed')));

    expect(result.kind === 'failure' && result.error).toBe(thrownError);
  });
});

interface SuppressedErrorShape extends Error {
  readonly error: unknown;
  readonly suppressed: unknown;
}

describe('RECOV-13: a deliberate outcome substitution is never auto-closed', () => {
  test('a recovery step returning a different Failure does not trigger a close', async () => {
    const {response, closeCount} = countingCloseResponse();
    const substituteStep: RecoveryStep = () =>
      Promise.resolve(failure(new Error('substituted, not thrown')));
    const chain = new ResponseRecoveryChain([], [substituteStep]);

    await chain.apply(success(response));

    expect(closeCount()).toBe(0);
  });

  test('a recovery step substituting a different Success does not trigger a close', async () => {
    const {response: original, closeCount} = countingCloseResponse();
    const substitute = aResponse();
    const substituteStep: RecoveryStep = () =>
      Promise.resolve(success(substitute));
    const chain = new ResponseRecoveryChain([], [substituteStep]);

    const result = await chain.apply(success(original));

    expect(closeCount()).toBe(0);
    expect(result.kind === 'success' && result.value).toBe(substitute);
  });
});

describe('RECOV-14: both step lists are defensively copied', () => {
  test('mutating the source arrays after construction has no effect on apply()', async () => {
    const responseSteps: ResponseStep[] = [];
    const recoverySteps: RecoveryStep[] = [];
    const chain = new ResponseRecoveryChain(responseSteps, recoverySteps);
    responseSteps.push(() => {
      throw new Error('must not run — pushed after construction');
    });
    recoverySteps.push(outcome => Promise.resolve(outcome));

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('success');
  });
});

describe('RECOV-8: apply() never throws, including on a step that lies about its type', () => {
  // RECOV-8 is absolute — "MUST NOT throw under any input" — and `recovery/` is plumbing a later
  // phase (and eventually a caller) installs steps into. TypeScript cannot enforce the return type
  // across that seam, so the two shapes a mistyped step produces are pinned here: a step whose
  // return value is not an outcome at all, and a step that then trips over it. Before this was
  // guarded, the second case raised `TypeError: undefined is not an object` out of `apply()`.
  test('a recovery step returning a non-outcome does not make apply() throw', async () => {
    const returnsNothing = (() =>
      Promise.resolve(undefined)) as unknown as RecoveryStep;
    const readsTheOutcome: RecoveryStep = outcome =>
      Promise.resolve(outcome.kind === 'failure' ? outcome : outcome);
    const chain = new ResponseRecoveryChain(
      [],
      [returnsNothing, readsTheOutcome],
    );

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
  });

  test('a response step returning a non-response does not make apply() throw', async () => {
    const returnsNothing = (() =>
      Promise.resolve(undefined)) as unknown as ResponseStep;
    const readsTheResponse: ResponseStep = response =>
      Promise.resolve(response.status.isError ? response : response);
    const chain = new ResponseRecoveryChain(
      [returnsNothing, readsTheResponse],
      [],
    );

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
  });

  test("the step's own throwable stays primary when the plumbing also fails", async () => {
    const returnsNothing = (() =>
      Promise.resolve(undefined)) as unknown as ResponseStep;
    const thrownError = new Error('step failed on a poisoned outcome');
    const throwingStep: ResponseStep = () => {
      throw thrownError;
    };
    const chain = new ResponseRecoveryChain([returnsNothing, throwingStep], []);

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
    const error = result.kind === 'failure' ? result.error : undefined;
    expect((error as SuppressedErrorShape).name).toBe('SuppressedError');
    expect((error as SuppressedErrorShape).error).toBe(thrownError);
  });
});

describe('apply() never throws (RECOV-8 property)', () => {
  // Canonical law for an invariant-bearing function: for an arbitrary mix of throwing and
  // non-throwing RESPONSE AND RECOVERY steps, over a seed outcome that is arbitrarily a Success or
  // a Failure, apply() always settles and never re-raises a step's throw (RECOV-8) — and no
  // response step runs on any generated case whose seed was already a Failure (RECOV-4).
  //
  // BOTH phases and BOTH seed variants must be generated: a generator emitting recovery steps only,
  // or seeding Success only, proves the RECOV-8 law and silently leaves RECOV-4 to the example
  // tests above.
  test('apply() settles and skips the response phase on a Failure seed, for arbitrary step sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), {maxLength: 4}),
        fc.array(fc.boolean(), {maxLength: 4}),
        fc.boolean(),
        async (responseFlags, recoveryFlags, seedIsSuccess) => {
          let responseStepRuns = 0;
          const responseSteps: ResponseStep[] = responseFlags.map(
            (shouldThrow, index) => response => {
              responseStepRuns += 1;
              if (shouldThrow)
                throw new Error(`response step ${String(index)} failed`);
              return Promise.resolve(response);
            },
          );
          const recoverySteps: RecoveryStep[] = recoveryFlags.map(
            (shouldThrow, index) => outcome => {
              if (shouldThrow)
                throw new Error(`recovery step ${String(index)} failed`);
              return Promise.resolve(outcome);
            },
          );
          const chain = new ResponseRecoveryChain(responseSteps, recoverySteps);
          const seed = seedIsSuccess
            ? success(aResponse())
            : failure<Response>(new Error('seed failure'));

          const result = await chain.apply(seed);

          expect(['success', 'failure']).toContain(result.kind);
          if (!seedIsSuccess) expect(responseStepRuns).toBe(0); // RECOV-4
        },
      ),
    );
  });
});

describe('RECOV-14: steps are safe for concurrent invocation', () => {
  // RECOV-14's SECOND normative clause: per-request state lives in the passed value, never on the
  // step or the chain. Guards the structural property that apply()'s only per-call state is its
  // `current` local — a later phase adding per-call bookkeeping to a chain field would fail here.
  test('two interleaved apply() calls on ONE chain instance do not observe each other', async () => {
    const gate: (() => void)[] = [];
    const slowStep: RecoveryStep = async outcome => {
      await new Promise<void>(resolve => gate.push(resolve));
      return outcome;
    };
    const chain = new ResponseRecoveryChain([], [slowStep]);
    const successSeed = success(aResponse());
    const failureSeed = failure<Response>(new Error('second call'));

    const first = chain.apply(successSeed);
    const second = chain.apply(failureSeed);
    await Promise.resolve();
    for (const release of gate) release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.kind).toBe('success');
    expect(
      secondResult.kind === 'failure' && (secondResult.error as Error).message,
    ).toBe('second call');
  });
});
