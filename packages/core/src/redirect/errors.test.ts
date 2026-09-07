// SPDX-License-Identifier: MIT
// packages/core/src/redirect/errors.test.ts
// Exercises: REDIR-6 (a non-replayable body fails with a clear error NAMING replayability, rather than
// corrupting or truncating the re-send), REDIR-15 (an HTTPS->HTTP hop is rejected with a clear error by
// default). Both are operational failures a caller can legitimately hit mid-redirect, so both are typed
// error leaves rather than `invariant()` programmer-error assertions.
// Also: OBS-11 (userinfo is always redacted to `***:***@`), OBS-12 (query values are `***` unless
// allow-listed), OBS-15 (redaction is total -- an unparseable input yields the sentinel, never a throw)
// and XCUT-19(a)/(b) as they apply to the ERROR MESSAGE rather than to a log field. The message is what
// every logger, `cause` chain and consumer `console.error` renders, so it is redacted at construction;
// `targetUrl` / `fromUrl` / `toUrl` stay raw for program use.
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
    // docs/knowledge/harvested/error-handling.md: identifying inputs are fields so they survive serialization
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

  test('redacts userinfo and non-allow-listed query values in the message', () => {
    const error = new NonReplayableBodyError(
      'https://alice:hunter2@example.com/next?access_token=SUPERSECRET&api-version=2',
    );

    expect(error.message).toContain('***:***@');
    expect(error.message).toContain('access_token=***');
    // OBS-12's default allow-list is exactly {api-version}, and the message inherits it whole.
    expect(error.message).toContain('api-version=2');
    expect(error.message).not.toContain('alice');
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('SUPERSECRET');
  });

  test('keeps the RAW target on the field even when the message is redacted', () => {
    const raw =
      'https://alice:hunter2@example.com/next?access_token=SUPERSECRET';
    expect(new NonReplayableBodyError(raw).targetUrl).toBe(raw);
  });

  test('degrades an unparseable target to the sentinel rather than throwing (OBS-15)', () => {
    // A target that never parsed cannot be redacted, and OBS-15 makes that total: the sentinel, not
    // the raw string, because "unparseable" is not the same as "carries no secret".
    const error = new NonReplayableBodyError('not a url?token=SUPERSECRET');

    expect(error.message).toContain('[malformed url]');
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.targetUrl).toBe('not a url?token=SUPERSECRET');
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

  test('redacts userinfo and non-allow-listed query values on BOTH sides of the message', () => {
    const error = new SchemeDowngradeError(
      'https://alice:hunter2@example.com/start?access_token=SUPERSECRET',
      'http://example.com/next?code=ALSOSECRET',
    );

    expect(error.message).toContain('***:***@');
    expect(error.message).toContain('access_token=***');
    expect(error.message).toContain('code=***');
    expect(error.message).not.toContain('alice');
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.message).not.toContain('ALSOSECRET');
  });

  test('keeps BOTH raw URLs on the fields even when the message is redacted', () => {
    const from = 'https://alice:hunter2@example.com/start?access_token=SECRET';
    const to = 'http://example.com/next?code=ALSOSECRET';
    const error = new SchemeDowngradeError(from, to);

    expect(error.fromUrl).toBe(from);
    expect(error.toUrl).toBe(to);
  });

  test('degrades an unparseable side to the sentinel rather than throwing (OBS-15)', () => {
    const error = new SchemeDowngradeError('::::', 'http://example.com/next');

    expect(error.message).toContain('[malformed url]');
    expect(error.message).toContain('http://example.com/next');
    expect(error.fromUrl).toBe('::::');
  });
});
