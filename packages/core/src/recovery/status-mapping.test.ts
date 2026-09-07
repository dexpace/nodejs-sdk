// SPDX-License-Identifier: MIT
// packages/core/src/recovery/status-mapping.test.ts
// Exercises: RECOV-15 (only 400..599 map to the matching typed exception; every other status passes
// through unchanged, and §8.2's conformance clause that an error status reaches a recovery hook as
// a Failure), RECOV-16 (the mapping reuses Phase 3b's already-bounded, replayable buffering — this
// file proves the wiring only; the 1 MiB cap and its truncation are 3b's own suite's job, at
// `body/http-status-error.test.ts`), RECOV-7 and RECOV-4 where the step meets the chain
import {describe, expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import {HttpStatusError} from '../body/http-status-error.js';
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
import {statusMappingStep} from './status-mapping.js';

function aResponse(
  status: number,
  body: ReadableStream<Uint8Array> | null = null,
): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .body(body)
    .build();
}

function bodyOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
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

describe('statusMappingStep (RECOV-15)', () => {
  test('returns a 2xx response unchanged', async () => {
    const response = aResponse(200);

    const result = await statusMappingStep(response);

    expect(result).toBe(response);
  });

  test('returns a 3xx response unchanged', async () => {
    const response = aResponse(304);

    const result = await statusMappingStep(response);

    expect(result).toBe(response);
  });

  test('returns a non-standard 6xx response unchanged — only 400..599 map', async () => {
    const response = aResponse(600);

    const result = await statusMappingStep(response);

    expect(result).toBe(response);
  });

  test('throws HttpStatusError naming the status for a 404', async () => {
    const error = await rejection(statusMappingStep(aResponse(404)));

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(404);
  });

  test('throws HttpStatusError for a 500', async () => {
    const error = await rejection(statusMappingStep(aResponse(500)));

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(500);
  });
});

describe('statusMappingStep buffering (RECOV-16)', () => {
  test('the error body survives on the thrown exception, replayable after the response is closed', async () => {
    const error = await rejection(
      statusMappingStep(aResponse(422, bodyOf('{"detail":"nope"}'))),
    );

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).preview()).toBe('{"detail":"nope"}');
  });
});

describe('statusMappingStep inside a recovery chain (RECOV-15, RECOV-7)', () => {
  // §8.2's own conformance clause for RECOV-15 is about the outcome the chain produces, not about
  // the step in isolation: a 400..599 must reach a recovery hook as a Failure carrying the typed
  // exception, exactly the way a transport error does. The step throwing is the mechanism; this is
  // the requirement.
  test('a 404 surfaces to a recovery hook as a Failure carrying the typed exception', async () => {
    const seen: Outcome<Response>[] = [];
    const recorder: RecoveryStep = outcome => {
      seen.push(outcome);
      return Promise.resolve(outcome);
    };
    const chain = new ResponseRecoveryChain([statusMappingStep], [recorder]);

    const result = await chain.apply(success(aResponse(404, bodyOf('nope'))));

    expect(result.kind).toBe('failure');
    const error = result.kind === 'failure' ? result.error : undefined;
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(404);
    expect((error as HttpStatusError).preview()).toBe('nope');
    expect(seen).toEqual([result]);
  });

  test('a 200 passes through the chain as a Success carrying the same response', async () => {
    const response = aResponse(200);
    const chain = new ResponseRecoveryChain([statusMappingStep], []);

    const result = await chain.apply(success(response));

    expect(result.kind === 'success' && result.value).toBe(response);
  });

  test('the step never runs on a Failure input — RECOV-4 governs, not the status', async () => {
    const seedError = new Error('transport failed');
    const chain = new ResponseRecoveryChain([statusMappingStep], []);

    const result = await chain.apply(failure(seedError));

    expect(result.kind === 'failure' && result.error).toBe(seedError);
  });
});

describe('statusMappingStep conforms to ResponseStep', () => {
  // The compile-time proof the discarded `: ResponseStep` annotation used to provide, kept out of
  // the module so nothing dead reaches `dist/`. Only fires under `bun run typecheck` — `bun test`
  // executes this file but strips its types without checking them (styleguide 11.6).
  test('its signature is exactly the ResponseStep signature', () => {
    expectTypeOf<typeof statusMappingStep>().toEqualTypeOf<ResponseStep>();
  });
});
