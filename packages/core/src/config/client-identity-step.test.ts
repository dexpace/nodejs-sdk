// SPDX-License-Identifier: MIT
// packages/core/src/config/client-identity-step.test.ts
// Exercises: RECOV-33 (Append mode joins tokens with single spaces and composes onto the FIRST
// existing value while preserving every other pre-existing value; an empty first value is treated as
// absent so no leading space is emitted; Replace mode overwrites; an empty or blank-joining token
// list is a no-op that never emits a blank or whitespace-only header), NFR-15 (the default tokens
// carry the real compiled-in version).
import {describe, expect, test} from 'bun:test';
import {HeaderValidationError} from '../http/errors.js';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import type {StepContext} from '../pipeline/step.js';
import {detectRuntimeIdentity, getBuildInfo} from './build-info.js';
import {clientIdentityStep} from './client-identity-step.js';

function requestWith(headers?: Headers): Request {
  const builder = Request.newBuilder().url('https://example.com');
  return headers === undefined
    ? builder.build()
    : builder.headers(headers).build();
}

/** What one drive of the step observed. */
interface StepRun {
  /** What the step handed to `next`; `undefined` if it never called `next`, or called it with nothing. */
  readonly forwarded: Request | undefined;
  readonly nextCalls: number;
  readonly rejection: unknown;
}

/**
 * Drives the step with a hand-rolled `next` that records what it was handed, counts its invocations,
 * and answers with a minimal 200 -- so a test can read the request the step actually forwarded and
 * assert the negative space (that a rejecting step forwarded nothing at all).
 *
 * `next` takes a **required** `Request`, though `StepContext`'s `Next` declares the parameter
 * optional. Deliberate: with an optional parameter and a `?? request` fallback, a step that called
 * `ctx.next()` -- forwarding nothing, which is a legal step idiom -- was indistinguishable from one
 * that forwarded the original instance, and the no-op test below could not tell them apart.
 */
async function driveStep(
  descriptor: ReturnType<typeof clientIdentityStep>,
  request: Request = requestWith(),
): Promise<StepRun> {
  let forwarded: Request | undefined;
  let nextCalls = 0;
  const context = {
    next: (handed: Request): Promise<Response> => {
      forwarded = handed;
      nextCalls += 1;
      return Promise.resolve(
        Response.newBuilder()
          .request(handed)
          .protocol(Protocol.HTTP_1_1)
          .status(Status.of(200))
          .build(),
      );
    },
    // `StepContext` also carries `context` and an optional `fork`; this step reads neither, so the
    // fake declares only `next` and the widening bridges what is missing.
  } as unknown as StepContext;

  try {
    await descriptor.fn(request, context);
    return {forwarded, nextCalls, rejection: undefined};
  } catch (reason: unknown) {
    return {forwarded, nextCalls, rejection: reason};
  }
}

/** The request the step forwarded, failing loudly if it rejected or forwarded nothing. */
async function forwardedRequest(
  descriptor: ReturnType<typeof clientIdentityStep>,
  request?: Request,
): Promise<Request> {
  const {forwarded, rejection} = await driveStep(descriptor, request);
  expect(rejection).toBeUndefined();
  if (forwarded === undefined) {
    throw new Error(
      'expected the step to forward a request, but it forwarded nothing',
    );
  }
  return forwarded;
}

describe('clientIdentityStep on the failure path', () => {
  test('rejects with a HeaderValidationError when a token is not header-safe', async () => {
    const {rejection} = await driveStep(
      clientIdentityStep({tokens: ['sdk/1.0\nX-Injected: evil']}),
    );

    expect(rejection).toBeInstanceOf(HeaderValidationError);
  });

  test('forwards nothing when composition fails', async () => {
    const original = requestWith(
      Headers.newBuilder().add('User-Agent', 'original').build(),
    );

    const {nextCalls} = await driveStep(
      clientIdentityStep({tokens: ['sdk/1.0\nX-Injected: evil']}),
      original,
    );

    expect(nextCalls).toBe(0);
  });

  test('leaves the inbound request untouched when composition fails', async () => {
    const original = requestWith(
      Headers.newBuilder().add('User-Agent', 'original').build(),
    );

    await driveStep(
      clientIdentityStep({tokens: ['sdk/1.0\nX-Injected: evil']}),
      original,
    );

    expect(original.headers.getAll('User-Agent')).toEqual(['original']);
  });

  test('composes cleanly from a runtime identity that could not be detected', async () => {
    // The end-to-end shape of the build-info guard: an ambient value carrying a non-ASCII byte
    // resolves to `unknown` at its source, so the step still emits a legal header rather than
    // failing every request that passes through it.
    const runtimeIdentity = detectRuntimeIdentity({
      navigator: {userAgent: 'Mozilla/5.0 (caf\u00e9)'},
    });

    const forwarded = await forwardedRequest(
      clientIdentityStep({tokens: ['dexpace-sdk/1.2.3', runtimeIdentity]}),
    );

    expect(forwarded.headers.getAll('User-Agent')).toEqual([
      'dexpace-sdk/1.2.3 unknown',
    ]);
  });
});

describe('clientIdentityStep placement', () => {
  test('occupies the outermost non-pillar slot', () => {
    expect(clientIdentityStep().stage).toBe('PRE_REDIRECT');
  });

  test('carries a stable identity symbol across instances', () => {
    expect(clientIdentityStep().type).toBe(
      clientIdentityStep({tokens: ['x']}).type,
    );
  });
});

describe('clientIdentityStep append mode (RECOV-33)', () => {
  test('sets the joined token line as the sole value when the header is absent', async () => {
    const step = clientIdentityStep({tokens: ['sdk/1.0', 'node/20']});

    const result = await forwardedRequest(step);

    expect(result.headers.getAll('User-Agent')).toEqual(['sdk/1.0 node/20']);
  });

  test('composes onto the first existing value and preserves every other value', async () => {
    const headers = Headers.newBuilder()
      .add('User-Agent', 'existing-agent')
      .add('User-Agent', 'second')
      .build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.getAll('User-Agent')).toEqual([
      'existing-agent sdk/1.0',
      'second',
    ]);
  });

  test('emits no leading space when the first existing value is empty', async () => {
    const headers = Headers.newBuilder().add('User-Agent', '').build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.get('User-Agent')).toBe('sdk/1.0');
  });
});

describe('clientIdentityStep append mode ordering (RECOV-33)', () => {
  test('keeps the header in its original position among the other headers', async () => {
    const headers = Headers.newBuilder()
      .add('Accept', 'application/json')
      .add('User-Agent', 'existing-agent')
      .add('X-Trailing', 'yes')
      .build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.names()).toEqual([
      'Accept',
      'User-Agent',
      'X-Trailing',
    ]);
  });

  test('matches the header name case-insensitively rather than adding a second one', async () => {
    const headers = Headers.newBuilder()
      .add('user-agent', 'existing-agent')
      .build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.getAll('User-Agent')).toEqual([
      'existing-agent sdk/1.0',
    ]);
  });

  test('leaves other headers untouched', async () => {
    const headers = Headers.newBuilder()
      .add('Accept', 'application/json')
      .build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.get('Accept')).toBe('application/json');
  });
});

describe('clientIdentityStep replace mode (RECOV-33)', () => {
  test('overwrites every existing value', async () => {
    const headers = Headers.newBuilder()
      .add('User-Agent', 'existing-agent')
      .add('User-Agent', 'second')
      .build();
    const step = clientIdentityStep({tokens: ['sdk/1.0'], mode: 'replace'});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.getAll('User-Agent')).toEqual(['sdk/1.0']);
  });
});

describe('clientIdentityStep no-op cases (RECOV-33)', () => {
  test('emits no header for an empty token list', async () => {
    const step = clientIdentityStep({tokens: []});

    const result = await forwardedRequest(step);

    expect(result.headers.get('User-Agent')).toBeUndefined();
  });

  test('emits no header when the tokens join to a blank line', async () => {
    const step = clientIdentityStep({tokens: ['', '   ']});

    const result = await forwardedRequest(step);

    expect(result.headers.get('User-Agent')).toBeUndefined();
  });

  test('leaves an existing header untouched when the token list is blank', async () => {
    const headers = Headers.newBuilder()
      .add('User-Agent', 'existing-agent')
      .build();
    const step = clientIdentityStep({tokens: []});

    const result = await forwardedRequest(step, requestWith(headers));

    expect(result.headers.getAll('User-Agent')).toEqual(['existing-agent']);
  });

  test('forwards the original request instance when it is a no-op', async () => {
    const request = requestWith();
    const step = clientIdentityStep({tokens: []});

    // Read straight off `driveStep`, whose `next` records exactly what it was handed. Going through
    // `forwardedRequest` would be just as strict now, but this states the claim at its narrowest:
    // the step passed *this instance*, not merely something that behaves like it.
    const {forwarded} = await driveStep(step, request);

    expect(forwarded).toBe(request);
  });
});

describe('clientIdentityStep configuration', () => {
  test('writes a caller-chosen header for a second identity line', async () => {
    const step = clientIdentityStep({
      headerName: 'X-Client-Info',
      tokens: ['app/2.0'],
    });

    const result = await forwardedRequest(step);

    expect(result.headers.get('X-Client-Info')).toBe('app/2.0');
    expect(result.headers.get('User-Agent')).toBeUndefined();
  });

  test('defaults to User-Agent carrying the build and runtime identity tokens (NFR-15)', async () => {
    const step = clientIdentityStep();

    const result = await forwardedRequest(step);

    expect(result.headers.get('User-Agent')).toBe(
      getBuildInfo().identityTokens.join(' '),
    );
  });

  test('does not alias the caller settings object after construction', async () => {
    const tokens = ['sdk/1.0'];
    const step = clientIdentityStep({tokens});

    tokens.push('sneaked/9.9');
    const result = await forwardedRequest(step);

    expect(result.headers.get('User-Agent')).toBe('sdk/1.0');
  });
});
