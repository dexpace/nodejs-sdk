// SPDX-License-Identifier: MIT
// packages/core/src/redirect/errors.test.ts
// Exercises: REDIR-6 (a non-replayable body fails with a clear error NAMING replayability, rather than
// corrupting or truncating the re-send), REDIR-15 (an HTTPS->HTTP hop is rejected with a clear error by
// default). Both are operational failures a caller can legitimately hit mid-redirect, so both are typed
// error leaves rather than `invariant()` programmer-error assertions.
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';

describe('NonReplayableBodyError', () => {
  test('names the target URL and mentions replayability', () => {
    const error = new NonReplayableBodyError('https://example.com/next');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.name).toBe('NonReplayableBodyError');
    expect(error.message).toContain('https://example.com/next');
    expect(error.message.toLowerCase()).toContain('replayable');
  });

  test('carries the target as a readonly field, not only in the message', () => {
    // docs/knowledge/error-handling.md: identifying inputs are fields so they survive serialization
    // and reach a structured log without anyone parsing the message back apart.
    const error = new NonReplayableBodyError('https://example.com/next');
    expect(error.targetUrl).toBe('https://example.com/next');
  });

  test('accepts a cause', () => {
    const cause = new Error('underlying');
    expect(
      new NonReplayableBodyError('https://example.com/next', {cause}).cause,
    ).toBe(cause);
  });
});

describe('SchemeDowngradeError', () => {
  test('names both the current and target URLs', () => {
    const error = new SchemeDowngradeError(
      'https://example.com/a',
      'http://example.com/b',
    );
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.name).toBe('SchemeDowngradeError');
    expect(error.message).toContain('https://example.com/a');
    expect(error.message).toContain('http://example.com/b');
  });

  test('carries both URLs as readonly fields, not only in the message', () => {
    const error = new SchemeDowngradeError(
      'https://example.com/a',
      'http://example.com/b',
    );
    expect(error.fromUrl).toBe('https://example.com/a');
    expect(error.toUrl).toBe('http://example.com/b');
  });

  test('accepts a cause', () => {
    const cause = new Error('underlying');
    const error = new SchemeDowngradeError('https://a', 'http://b', {cause});
    expect(error.cause).toBe(cause);
  });
});
