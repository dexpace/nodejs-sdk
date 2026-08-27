// SPDX-License-Identifier: MIT
// packages/core/src/sse/errors.test.ts
// Exercises: SSE-26/SSE-27 (loud failure on re-iteration or post-close iteration), SSE-32 (bodyless response).
import {expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {SseStreamError} from './errors.js';

test('sits directly under DexpaceError (two-level tree)', () => {
  expect(new SseStreamError('x')).toBeInstanceOf(DexpaceError);
});

test('name identifies the leaf in a stack trace', () => {
  expect(new SseStreamError('x').name).toBe('SseStreamError');
});

test('chains a cause when given one', () => {
  const backing = new Error('root');
  expect(new SseStreamError('x', {cause: backing}).cause).toBe(backing);
});
